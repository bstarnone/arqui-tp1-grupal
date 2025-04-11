import { createClient } from "redis";

const client = createClient({
  url: "redis://redis:6379",
}).on("error", (err) => console.log("Redis Client Error", err));

client.connect();

export async function get(key) {
  return await client.get(key);
}

export async function set(key, value) {
  return await client.set(key, value);
}

export async function hget(key, field) {
  return await client.hGet(key, field);
}

export async function hset(key, field, value) {
  return await client.hSet(key, field, value);
}

export async function hgetall(key) {
  return await client.hGetAll(key);
}

export const redis = {
  get,
  set,
  hget,
  hset,
  hgetall
};
