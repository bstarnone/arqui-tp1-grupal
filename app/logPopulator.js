import { nanoid } from "nanoid";
import fs from "fs";

const exchangeMap = {
  ARS: {
    BRL: 0.00553,
    EUR: 0.00091,
    USD: 0.00094,
  },
  BRL: {
    ARS: 180.8,
  },
  EUR: {
    ARS: 1104,
  },
  USD: {
    ARS: 1064,
  },
};

const currencies = Object.keys(exchangeMap);

function getRandomDate(start, end) {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime())
  );
}

function getRandomPair() {
  const from = currencies[Math.floor(Math.random() * currencies.length)];
  const toOptions = Object.keys(exchangeMap[from] || {});
  const to = toOptions.length
    ? toOptions[Math.floor(Math.random() * toOptions.length)]
    : null;
  return { from, to };
}

function generateExchangeRequest() {
  let pair;
  do {
    pair = getRandomPair();
  } while (!pair.to);

  return {
    from: pair.from,
    to: pair.to,
    amount: parseFloat((Math.random() * 10000 + 10).toFixed(2)), // 10 to 10000
  };
}

function generateExchangeResult() {
  const request = generateExchangeRequest();
  const rate = exchangeMap[request.from]?.[request.to];

  const success = rate !== undefined;
  return {
    id: nanoid(),
    ts: getRandomDate(new Date(2024, 0, 1), new Date()),
    ok: success,
    request,
    exchangeRate: rate ?? null,
    counterAmount: success
      ? parseFloat((request.amount * rate).toFixed(2))
      : 0.0,
    obs: success ? null : "Exchange rate not available.",
  };
}

// Generate the log
const log = Array.from({ length: 100 }, generateExchangeResult);

// Write to file
fs.writeFileSync("exchange_log.json", JSON.stringify(log, null, 2));
console.log("Log written to exchange_log.json");
