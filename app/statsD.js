import { StatsD } from "hot-shots";

const statsd = new StatsD({
  host: "graphite",
  port: 8125,
  prefix: "exchange.",
});

export default statsd;
