import { createClient } from "redis";

const cache_client = createClient({
  url: "redis://redis:6379",
}).on("error", (err) => console.log("Redis Client Error", err));

cache_client.connect();

export const redis = {
  cache_client,
};
