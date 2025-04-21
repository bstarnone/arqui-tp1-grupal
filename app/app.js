import express from "express";
import { StatsD } from "hot-shots";

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

const statsd = new StatsD({
  host: "graphite",
  port: 8125,
  prefix: "exchange.",
});

app.use(express.json());

// ACCOUNT endpoints

app.get("/accounts", async (req, res) => {
  const accounts = await getAccounts();
  res.status(200).json(accounts);
});

app.put("/accounts/:id/balance", async (req, res) => {
  const accountId = req.params.id;
  const { balance } = req.body;

  if (!accountId || !balance) {
    return res.status(400).json({ error: "Malformed request" });
  } else {
    const parsedAccount = await setAccountBalance(accountId, balance);
    res.status(200).json(parsedAccount);
  }
});

// RATE endpoints

app.get("/rates", async (req, res) => {
  const rates = await getRates();
  res.status(200).json(rates);
});

app.put("/rates", async (req, res) => {
  const { baseCurrency, counterCurrency, rate } = req.body;

  if (!baseCurrency || !counterCurrency || !rate) {
    return res.status(400).json({ error: "Malformed request" });
  }

  const newRateRequest = { ...req.body };
  const parsedRates = await setRate(newRateRequest);
  res.status(200).json(parsedRates);
});

// LOG endpoint

app.get("/log", async (req, res) => {
  const log = await getLog();
  res.status(200).json(log);
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
    statsd.gaugeDelta(`currency.${baseCurrency}.volume`, baseAmount);
    statsd.gaugeDelta(`currency.${counterCurrency}.volume`, baseAmount);
    statsd.gaugeDelta(`currency.${baseCurrency}.net`, -baseAmount); // Negative for sells
    statsd.gaugeDelta(`currency.${counterCurrency}.net`, baseAmount); // Positive for buys
    res.status(200).json(exchangeResult);
  } else {
    res.status(500).json(exchangeResult);
  }
});

app.listen(port, () => {
  console.log(`Exchange API listening on port ${port}`);
});

export default app;
