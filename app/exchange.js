import { nanoid } from "nanoid";
import { accounts, rates, log } from "./mongo.js";
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
  const accountsData = await accounts.find({}).toArray();
  const ratesData = await rates.find({}).toArray();
  const logData = await log.find({}).toArray();
  if (accountsData.length === 0 && ratesData.length === 0 && logData.length === 0) {
    console.log("No data in DB, saving state from disk...");
    await saveState();
  }
}

export async function saveState() {
  try {
    const accountsData = fs.readFileSync(path.join(__dirname, ACCOUNTS));
    const accountsList = JSON.parse(accountsData);
    accountsList.forEach(account => {
      accounts.insertOne({
        _id: account.id,
        currency: account.currency,
        balance: account.balance
      });
    });

    const ratesData = fs.readFileSync(path.join(__dirname, RATES));
    const ratesObj = JSON.parse(ratesData);
    
    // Crear un documento por cada moneda base
    for (const [baseCurrency, counterCurrencies] of Object.entries(ratesObj)) {
      await rates.insertOne({
        baseCurrency,
        rates: counterCurrencies
      });
    }

    const logData = fs.readFileSync(path.join(__dirname, LOG));
    const logList = JSON.parse(logData);
    logList.forEach(logEntry => {
      log.insertOne(logEntry);
    });

  } catch (error) {
    console.error("Error initializing data:", error);
    throw error;
  }
}

//returns all internal accounts
export async function getAccounts() {
    const accountsData = await accounts.find({}).toArray();
    return accountsData;
} 

//sets balance for an account
export async function setAccountBalance(accountId, balance) {
  let account = await redis.cache_client.hGet("accounts", accountId);
  if (!account) {
    console.log("account not found in cache, fetching from DB");
    account = await accounts.findOne({ _id: Number(accountId) });
    console.log("Found account:", account);
    if (!account) {
      throw new Error("Account not found");
    } 
  } else {
    account = JSON.parse(account);
  }
  account.balance = balance;
  await accounts.updateOne({ _id: Number(accountId) }, { $set: { balance } });
  redis.cache_client.hSet("accounts", accountId, JSON.stringify(account));
  return account;
}

//returns all current exchange rates
export async function getRates() {
  const ratesData = await rates.find({}).toArray();
  return ratesData;
}

//returns the whole transaction log
export async function getLog() {
  const logData = await log.find({}).toArray();
  return logData;
}

//sets the exchange rate for a given pair of currencies, and the reciprocal rate as well
export async function setRate(rateRequest) {
  const { baseCurrency, counterCurrency, rate } = rateRequest;

  let baseRate = await redis.cache_client.hGet("rates", baseCurrency);
  let counterRate = await redis.cache_client.hGet("rates", counterCurrency);
  
  if (!baseRate) {
    baseRate = await rates.findOne({ baseCurrency: baseCurrency});
    console.log("baseRate not found in cache, fetching from DB");
  } else {
    baseRate = JSON.parse(baseRate);
  }
  
  if (!counterRate) {
    counterRate = await rates.findOne({ baseCurrency: counterCurrency });
    console.log("counterRate not found in cache, fetching from DB");
  } else {
    counterRate = JSON.parse(counterRate);
  }
  
  baseRate.rates[counterCurrency] = rate;
  counterRate.rates[baseCurrency] = Number((1 / rate).toFixed(5));

  await rates.updateOne({ baseCurrency: baseCurrency }, { $set: { rates: baseRate.rates } });
  await rates.updateOne({ baseCurrency: counterCurrency }, { $set: { rates: counterRate.rates } });
  
  redis.cache_client.hSet("rates", baseCurrency, JSON.stringify(baseRate));
  redis.cache_client.hSet("rates", counterCurrency, JSON.stringify(counterRate));

  
  return baseRate;
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

  let rate = await redis.cache_client.hGet("rates", baseCurrency);
  if (!rate) {
    console.log("rate not found in cache, fetching from DB");
    rate = await rates.findOne({ baseCurrency });
  } else {
    rate = JSON.parse(rate);
  }
  
  //get the exchange rate
  const exchangeRate = rate.rates[counterCurrency];
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
        await transfer(counterAccount._id, clientCounterAccountId, counterAmount)
      ) {
        //all good, update balances
        baseAccount.balance += baseAmount;
        counterAccount.balance -= counterAmount;
        exchangeResult.ok = true;
        exchangeResult.counterAmount = counterAmount;
        
        await accounts.updateOne({ _id: Number(baseAccount._id) }, { $set: { balance: baseAccount.balance } });
        await accounts.updateOne({ _id: Number(counterAccount._id) }, { $set: { balance: counterAccount.balance } });
        
      } else {
        //could not transfer to clients' counter account, return base amount to client
        await transfer(baseAccount._id, clientBaseAccountId, baseAmount);
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
  await log.insertOne(exchangeResult);

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
  const account = await accounts.findOne({
    currency: currency
  });
  if (!account) {
    return null;
  }
  return account;
}

async function findAccountById(id) {
  const account = await accounts.findOne({ _id: Number(id)  });
  if (!account) {
    return null;
  }
  return account;
}
