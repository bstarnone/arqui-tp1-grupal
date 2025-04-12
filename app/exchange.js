import { nanoid } from "nanoid";
import { redis } from "./redis.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACCOUNTS = "./state/accounts.json";
const RATES = "./state/rates.json";
const LOG = "./state/log.json";

export async function init() {
  try {
    const accountsData = fs.readFileSync(path.join(__dirname, ACCOUNTS));
    const accounts = JSON.parse(accountsData);
    accounts.forEach(account => {
      redis.client.hSet("accounts", account.id, JSON.stringify(account));
    });

    const ratesData = fs.readFileSync(path.join(__dirname, RATES));
    const rates = JSON.parse(ratesData);
    Object.keys(rates).forEach(rate => {
      redis.client.hSet("rates", rate, JSON.stringify(rates[rate]));
    });

    const logData = fs.readFileSync(path.join(__dirname, LOG));
    const log = JSON.parse(logData);
    log.forEach(log => {
      redis.client.hSet("log", log.id, JSON.stringify(log));
    });

  } catch (error) {
    console.error("Error initializing data:", error);
    throw error;
  }
}

//returns all internal accounts
export async function getAccounts() {
  const accounts = await redis.client.hGetAll('accounts');
  const parsedAccounts = Object.values(accounts).map(account => JSON.parse(account));
  return parsedAccounts;
} 

//sets balance for an account
export async function setAccountBalance(accountId, balance) {
  const account = await redis.client.hGet("accounts", accountId);
  if (!account) {
    throw new Error("Account not found");
  }
  const parsedAccount = JSON.parse(account);
  parsedAccount.balance = balance;
  await redis.client.hSet("accounts", accountId, JSON.stringify(parsedAccount));
  return parsedAccount;
}

//returns all current exchange rates
export async function getRates() {
  const rates = await redis.client.hGetAll("rates");
  const parsedRates = Object.fromEntries(
    Object.entries(rates).map(([key, value]) => [key, JSON.parse(value)])
  );
  return parsedRates;
}

//returns the whole transaction log
export async function getLog() {
  const log = await redis.client.hGetAll("log");
  const parsedLog = Object.values(log).map(log => JSON.parse(log));
  return parsedLog;
}

//sets the exchange rate for a given pair of currencies, and the reciprocal rate as well
export async function setRate(rateRequest) {
  const { baseCurrency, counterCurrency, rate } = rateRequest;

  const baseRate = await redis.client.hGet("rates", baseCurrency);
  const counterRate = await redis.client.hGet("rates", counterCurrency);
  const parsedBaseRate = JSON.parse(baseRate);
  const parsedCounterRate = JSON.parse(counterRate);

  parsedBaseRate[counterCurrency] = rate;
  parsedCounterRate[baseCurrency] = Number((1 / rate).toFixed(5));

  await redis.client.hSet("rates", baseCurrency, JSON.stringify(parsedBaseRate));
  await redis.client.hSet("rates", counterCurrency, JSON.stringify(parsedCounterRate));

  const parsedRates = {
    [baseCurrency]: parsedBaseRate,
    [counterCurrency]: parsedCounterRate
  };

  return parsedRates;
}

//executes an exchange operation
export async function exchange(exchangeRequest) {
  const {
    baseCurrency,
    counterCurrency,
    baseAccountId: clientBaseAccountId,
    counterAccountId: clientCounterAccountId,
    baseAmount,
  } = exchangeRequest;

  const rate = await redis.client.hGet("rates", baseCurrency); 
  const parsedRate = JSON.parse(rate);
  //get the exchange rate
  const exchangeRate = parsedRate[counterCurrency];
  //compute the requested (counter) amount
  const counterAmount = baseAmount * exchangeRate;
  //find our account on the provided (base) currency
  const baseAccount = await findAccountByCurrency(baseCurrency);
  //find our account on the counter currency
  const counterAccount = await findAccountByCurrency(counterCurrency);

  //construct the result object with defaults
  const exchangeResult = {
    id: nanoid(),
    ts: new Date(),
    ok: false,
    request: exchangeRequest,
    exchangeRate: exchangeRate,
    counterAmount: 0.0,
    obs: null,
  };
  //check if we have funds on the counter currency account
  if (counterAccount.balance >= counterAmount) {
    //try to transfer from clients' base account
    if (await transfer(clientBaseAccountId, baseAccount.id, baseAmount)) {
      //try to transfer to clients' counter account
      if (
        await transfer(counterAccount.id, clientCounterAccountId, counterAmount)
      ) {
        //all good, update balances
        baseAccount.balance += baseAmount;
        counterAccount.balance -= counterAmount;
        exchangeResult.ok = true;
        exchangeResult.counterAmount = counterAmount;
        await redis.client.hSet("accounts", baseAccount.id, JSON.stringify(baseAccount));
        await redis.client.hSet("accounts", counterAccount.id, JSON.stringify(counterAccount));
      } else {
        //could not transfer to clients' counter account, return base amount to client
        await transfer(baseAccount.id, clientBaseAccountId, baseAmount);
        exchangeResult.obs = "Could not transfer to clients' account";
      }
    } else {
      //could not withdraw from clients' account
      exchangeResult.obs = "Could not withdraw from clients' account";
    }
  } else {
    //not enough funds on internal counter account
    exchangeResult.obs = "Not enough funds on counter currency account";
  }

  //log the transaction and return it
  await redis.client.hSet("log", exchangeResult.id, JSON.stringify(exchangeResult));

  return exchangeResult;
}

// internal - call transfer service to execute transfer between accounts
async function transfer(fromAccountId, toAccountId, amount) {
  const min = 200;
  const max = 400;
  return new Promise((resolve) =>
    setTimeout(() => resolve(true), Math.random() * (max - min + 1) + min)
  );
}

async function findAccountByCurrency(currency) {
  const accounts = await redis.client.hGetAll("accounts");
  const parsedAccounts = Object.values(accounts).map(account => JSON.parse(account));
  const parsedAccount = parsedAccounts.find(account => account.currency === currency);
  return parsedAccount;
}

async function findAccountById(id) {
  const account = await redis.client.hGet("accounts", id);
  const parsedAccount = JSON.parse(account);
  return parsedAccount;
}
