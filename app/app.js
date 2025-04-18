import express from "express";
import limiter from "limiter.js"

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

// ACCOUNT endpoints

app.get("/accounts", limiter(200), (_, res) => {
  console.log("GET /accounts");
  try {
    const accounts = getAccounts();
    res.status(200).json(accounts);
  } catch (error) {
    res.status(error.statusCode).send(error.message);
  }
});

app.put("/accounts/:id/balance", limiter(200), (req, res) => {
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

app.get("/rates", limiter(3), (_, res) => {
  try {
    const rates = getRates();
    res.status(200).json(rates);
  } catch (error) {
    res.status(error.statusCode).send(error.message);
  }
});

app.put("/rates", (req, res) => {
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

app.get("/log", (_, res) => {
  try {
    const log = getLog();
    res.status(200).json(log);
  } catch (error) {
    res.status(error.statusCode).send(error.message);
  }
});

// EXCHANGE endpoint

app.post("/exchange", async (req, res) => {
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

  const exchangeRequest = { ...req.body };
  const exchangeResult = await exchange(exchangeRequest);

  if (exchangeResult.ok) {
    res.status(200).json(exchangeResult);
  } else {
    res.status(500).json(exchangeResult);
  }
});

app.listen(port, () => {
  console.log(`Exchange API listening on port ${port}`);
});

export default app;