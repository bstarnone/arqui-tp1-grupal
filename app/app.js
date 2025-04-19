import express from "express";
import limiter from "./limiter.js"

import {
  init as exchangeInit,
  getAccounts,
  setAccountBalance,
  getRates,
  setRate,
  getLog,
  exchange,
} from "./exchange.js";

await exchangeInit();

const app = express();
const port = 3000;

app.use(express.json());

const LOG_REQ_PER_WINDOW = 100;
const RATES_REQ_PER_WINDOW = 20;
const ACCOUNTS_REQ_PER_WINDOW = 200;
const EXCHANGE_REQ_PER_WINDOW = 100;

// ACCOUNT endpoints

app.get("/accounts", limiter(ACCOUNTS_REQ_PER_WINDOW), (_, res) => {
  console.log("GET /accounts");
  try {
    const accounts = getAccounts();
    res.status(200).json(accounts);
  } catch (error) {
    res.status(error.statusCode).send(error.message);
  }
});

app.put("/accounts/:id/balance", limiter(ACCOUNTS_REQ_PER_WINDOW), (req, res) => {
  const accountId = req.params.id;
  const { balance } = req.body;

  if (!accountId || !balance) {
    return res.status(400).json({ error: "Malformed request" });
  } else {
    try {
      const parsedAccount = setAccountBalance(accountId, balance);
      res.status(200).json(parsedAccount);
    } catch (error) {
      res.status(error.statusCode).send(error.message);
    }
  }
});

// RATE endpoints

app.get("/rates", limiter(RATES_REQ_PER_WINDOW), (_, res) => {
  try {
    const rates = getRates();
    res.status(200).json(rates);
  } catch (error) {
    res.status(error.statusCode).send(error.message);
  }
});

app.put("/rates", limiter(RATES_REQ_PER_WINDOW), (req, res) => {
  const { baseCurrency, counterCurrency, rate } = req.body;

  if (!baseCurrency || !counterCurrency || !rate) {
    return res.status(400).json({ error: "Malformed request" });
  }

  const newRateRequest = { ...req.body };
  try {
    const parsedRates = setRate(newRateRequest);
    res.status(200).json(parsedRates);
  } catch (error) {
    res.status(error.statusCode).send(error.message);
  }
});

// LOG endpoint

app.get("/log", limiter(LOG_REQ_PER_WINDOW), (_, res) => {
  try {
    const log = getLog();
    res.status(200).json(log);
  } catch (error) {
    res.status(error.statusCode).send(error.message);
  }
});

// EXCHANGE endpoint

app.post("/exchange", limiter(EXCHANGE_REQ_PER_WINDOW), async (req, res) => {
  const {
    baseCurrency,
    counterCurrency,
    baseAccountId,
    counterAccountId,
    baseAmount,
  } = req.body;

  if (
    !baseCurrency ||
    !counterCurrency ||
    !baseAccountId ||
    !counterAccountId ||
    !baseAmount
  ) {
    return res.status(400).json({ error: "Malformed request" });
  }

  try {
    const exchangeRequest = { ...req.body };
    const exchangeResult = await exchange(exchangeRequest);
    res.status(200).json(exchangeResult);
  } catch (error) {
    res.status(error.statusCode).send(error.message);
  }
});

app.listen(port, () => {
  console.log(`Exchange API listening on port ${port}`);
});

export default app;