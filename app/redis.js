import { createClient } from "redis";

const client = createClient({
  url: "redis://redis:6379",
}).on("error", (err) => console.log("Redis Client Error", err));

client.connect();


export const redis = {
  client
};
