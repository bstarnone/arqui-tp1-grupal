import { nanoid } from "nanoid";
import { accounts, rates, log, operations } from "./mongo.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { count } from "console";
import statsd from "./statsD.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACCOUNTS = "./state/accounts.json";
const RATES = "./state/rates.json";
const LOG = "./state/log.json";

export async function init() {
  const data = await Promise.all([
    log.find({}).toArray(),
    rates.find({}).toArray(),
    accounts.find({}).toArray(),
    operations.find({}).toArray(),
  ]);

  if (
    (data[0].length === 0 && data[1].length === 0 && data[2].length === 0,
    data[3].length === 0)
  ) {
    console.log("No data in DB, saving state from disk...");
    await saveState();
  }

  let fetchedOperations = data[3];
  if (data[3].length === 0) {
    // Fetch data and then set gauge
    console.log("🚀 Fetching operations.... (data[3] no length)");

    fetchedOperations = await operations.find({}).toArray();

    console.log("🚀 ~ init ~ fetchedOperations:", fetchedOperations);
  }

  console.log("🚀 ~ init ~ fetchedOperations:", fetchedOperations);
  for (const currencyOperations of fetchedOperations) {
    await Promise.all([
      statsd.gauge(
        `currency.${currencyOperations.currency}.volume`,
        currencyOperations.volume
      ),
      statsd.gauge(
        `currency.${currencyOperations.currency}.net`,
        currencyOperations.net
      ),
    ]);
  }
}

export async function saveState() {
  try {
    const accountsData = fs.readFileSync(path.join(__dirname, ACCOUNTS));
    const accountsList = JSON.parse(accountsData);
    accountsList.forEach((account) => {
      accounts.insertOne({
        _id: account.id,
        currency: account.currency,
        balance: account.balance,
      });
    });

    const ratesData = fs.readFileSync(path.join(__dirname, RATES));
    const ratesObj = JSON.parse(ratesData);
    // Crear un documento por cada moneda base
    const insertedCurrencies = new Set();
    for (const [baseCurrency, counterCurrencies] of Object.entries(ratesObj)) {
      console.log("🚀 ~ saveState ~ counterCurrencies:", counterCurrencies);
      console.log("🚀 ~ saveState ~ baseCurrency:", baseCurrency);
      await rates.insertOne({
        baseCurrency,
        rates: counterCurrencies,
      });
      console.log("🚀 ~ saveState ~ insertedCurrencies:", insertedCurrencies);

      if (!insertedCurrencies.has(baseCurrency)) {
        await operations.insertOne({
          currency: baseCurrency,
          net: 0,
          volume: 0,
        });
        insertedCurrencies.add(baseCurrency);
      }

      for (const [currency, _] of Object.entries(counterCurrencies)) {
        if (!insertedCurrencies.has(currency)) {
          await operations.insertOne({
            currency: currency,
            net: 0,
            volume: 0,
          });
          insertedCurrencies.add(currency);
        }
      }
    }

    const logData = fs.readFileSync(path.join(__dirname, LOG));
    const logList = JSON.parse(logData);
    logList.forEach((logEntry) => {
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
  const account = await accounts.findOne({ _id: Number(accountId) });
  console.log("Found account:", account);
  if (!account) {
    throw new Error("Account not found");
  }
  account.balance = balance;
  await accounts.updateOne({ _id: Number(accountId) }, { $set: { balance } });
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

  let baseRate = await rates.findOne({ baseCurrency: baseCurrency });
  let counterRate = await rates.findOne({ baseCurrency: counterCurrency });

  baseRate.rates[counterCurrency] = rate;
  counterRate.rates[baseCurrency] = Number((1 / rate).toFixed(5));

  await rates.updateOne(
    { baseCurrency: baseCurrency },
    { $set: { rates: baseRate.rates } }
  );
  await rates.updateOne(
    { baseCurrency: counterCurrency },
    { $set: { rates: counterRate.rates } }
  );

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

  let rate = await rates.findOne({ baseCurrency });

  //get the exchange rate
  const exchangeRate = rate.rates[counterCurrency];
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
        await transfer(
          counterAccount._id,
          clientCounterAccountId,
          counterAmount
        )
      ) {
        //all good, update balances
        baseAccount.balance += baseAmount;
        counterAccount.balance -= counterAmount;
        exchangeResult.ok = true;
        exchangeResult.counterAmount = counterAmount;

        await Promise.all([
          accounts.updateOne(
            { _id: Number(counterAccount._id) },
            { $set: { balance: counterAccount.balance } }
          ),
          accounts.updateOne(
            { _id: Number(baseAccount._id) },
            { $set: { balance: baseAccount.balance } }
          ),
          operations.updateOne(
            { currency: baseCurrency },
            { $inc: { net: -baseAmount, volume: baseAmount } }
          ),
          operations.updateOne(
            { currency: counterCurrency },
            { $inc: { net: counterAmount, volume: counterAmount } }
          ),
        ]);
        statsd.gaugeDelta(`currency.${baseCurrency}.volume`, baseAmount);
        statsd.gaugeDelta(`currency.${counterCurrency}.volume`, counterAmount);
        statsd.gaugeDelta(`currency.${baseCurrency}.net`, -baseAmount); // Negative for sells
        statsd.gaugeDelta(`currency.${counterCurrency}.net`, counterAmount); // Positive for buys
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
    currency: currency,
  });
  if (!account) {
    return null;
  }
  return account;
}

async function findAccountById(id) {
  const account = await accounts.findOne({ _id: Number(id) });
  if (!account) {
    return null;
  }
  return account;
}
