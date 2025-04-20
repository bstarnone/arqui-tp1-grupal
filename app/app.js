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

app.get("/accounts", (req, res) => {
  res.json(getAccounts());
});

app.put("/accounts/:id/balance", (req, res) => {
  const accountId = req.params.id;
  const { balance } = req.body;

  if (!accountId || !balance) {
    return res.status(400).json({ error: "Malformed request" });
  } else {
    setAccountBalance(accountId, balance);

    res.json(getAccounts());
  }
});

// RATE endpoints

app.get("/rates", (req, res) => {
  res.json(getRates());
});

app.put("/rates", (req, res) => {
  const { baseCurrency, counterCurrency, rate } = req.body;

  if (!baseCurrency || !counterCurrency || !rate) {
    return res.status(400).json({ error: "Malformed request" });
  }

  const newRateRequest = { ...req.body };
  setRate(newRateRequest);

  res.json(getRates());
});

// LOG endpoint

app.get("/log", (req, res) => {
  res.json(getLog());
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

  // if (exchangeResult.ok) {
  //   statsd.gauge(`currency.${baseCurrency}.sells`, baseAmount);
  //   statsd.gauge(`currency.${counterCurrency}.buys`, baseAmount);
  //   statsd.gauge(`currency.${baseCurrency}.net`, -baseAmount);
  //   statsd.gauge(`currency.${counterCurrency}.net`, baseAmount);

  //   res.status(200).json(exchangeResult);
  // }
  if (exchangeResult.ok) {
    statsd.increment(`currency.${baseCurrency}.sells`, baseAmount);
    statsd.increment(`currency.${counterCurrency}.buys`, baseAmount);

    statsd.decrement(`currency.${baseCurrency}.net`, baseAmount);
    statsd.increment(`currency.${counterCurrency}.net`, baseAmount);

    statsd.increment(`currency.${baseCurrency}.volume`, baseAmount);
    statsd.increment(`currency.${counterCurrency}.volume`, baseAmount);

    res.status(200).json(exchangeResult);
  } else {
    res.status(500).json(exchangeResult);
  }
});

app.listen(port, () => {
  console.log(`Exchange API listening on port ${port}`);
});

export default app;
