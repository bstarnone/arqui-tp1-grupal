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
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8'));
  const rates = JSON.parse(fs.readFileSync(RATES, 'utf8'));
  const log = JSON.parse(fs.readFileSync(LOG, 'utf8'));

  for (const account of accounts) {
    await redis.hset('accounts', account.id.toString(), JSON.stringify(account));
  }

  for (const [baseCurrency, ratesObj] of Object.entries(rates)) {
    for (const [counterCurrency, rate] of Object.entries(ratesObj)) {
      await redis.hset('rates', `${baseCurrency}:${counterCurrency}`, rate.toString());
    }
  }

  for (const entry of log) {
    await redis.hset('logs', entry.id, JSON.stringify(entry));
  }
}

//returns all internal accounts
export async function getAccounts() {
  const accounts = await redis.hgetall('accounts');
  return Object.values(accounts).map(account => JSON.parse(account));
} 

//sets balance for an account
export async function setAccountBalance(accountId, balance) {
  const account = await redis.hget('accounts', accountId);
  
  if (account != null) {
    const accountData = JSON.parse(account);
    accountData.balance = balance;
    await redis.hset('accounts', accountId, JSON.stringify(accountData));
  }
}

//returns all current exchange rates
export async function getRates() {
  const rates = await redis.hgetall('rates');
  return Object.entries(rates).reduce((acc, [key, value]) => {
    const [base, counter] = key.split(':');
    if (!acc[base]) acc[base] = {};
    acc[base][counter] = parseFloat(value);
    return acc;
  }, {});
}

//returns the whole transaction log
export async function getLog() {
  const logs = await redis.hgetall('logs');
  return Object.values(logs).map(log => JSON.parse(log));
}

//sets the exchange rate for a given pair of currencies, and the reciprocal rate as well
export async function setRate(rateRequest) {
  const { baseCurrency, counterCurrency, rate } = rateRequest;
  
  await redis.hset('rates', `${baseCurrency}:${counterCurrency}`, rate.toString());
  await redis.hset('rates', `${counterCurrency}:${baseCurrency}`, (1/rate).toFixed(5));
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

  //get the exchange rate
  const exchangeRate = parseFloat(await redis.hget('rates', `${baseCurrency}:${counterCurrency}`));
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
      if (await transfer(counterAccount.id, clientCounterAccountId, counterAmount)) {
        //all good, update balances
        baseAccount.balance += baseAmount;
        counterAccount.balance -= counterAmount;
        
        // Update balances in Redis
        await redis.hset('accounts', baseAccount.id.toString(), JSON.stringify(baseAccount));
        await redis.hset('accounts', counterAccount.id.toString(), JSON.stringify(counterAccount));
        
        exchangeResult.ok = true;
        exchangeResult.counterAmount = counterAmount;
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
  await redis.hset('logs', exchangeResult.id, JSON.stringify(exchangeResult));

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
  const accounts = await redis.hgetall('accounts');
  for (let [id, accountStr] of Object.entries(accounts)) {
    const account = JSON.parse(accountStr);
    if (account.currency == currency) {
      return account;
    }
  }
  return null;
}

async function findAccountById(id) {
  const accountStr = await redis.hget('accounts', id.toString());
  return accountStr ? JSON.parse(accountStr) : null;
}
