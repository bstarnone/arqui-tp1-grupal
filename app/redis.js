import { createClient } from "redis";

const cache_client = createClient({
  url: "redis://rediscache:6379",
}).on("error", (err) => console.log("Redis Client Error", err));

cache_client.connect();

const db_client = createClient({
  url: "redis://redisdb:6380",
}).on("error", (err) => console.log("Redis Client Error", err));

db_client.connect();

async function getFromCache(cacheKey, dbKey, ttl = 60) {
  let data = await cache_client.hGetAll(cacheKey);
  if (Object.keys(data).length === 0) {
    console.log(`Cache miss for ${cacheKey}`);
    data = await db_client.hGetAll(dbKey);
    if (Object.keys(data).length > 0) {
      await cache_client.hSet(cacheKey, data);
      await cache_client.expire(cacheKey, ttl);
    }
  }
  return data;
}

async function getSingleFromCache(cacheKey, id, dbKey, ttl = 60) {
  let data = await cache_client.hGet(cacheKey, id);
  if (!data) {
    console.log(`Cache miss for ${cacheKey}:${id}`);
    data = await db_client.hGet(dbKey, id);
    if (data) {
      await cache_client.hSet(cacheKey, id, data);
      await cache_client.expire(cacheKey, ttl);
    }
  }
  return data;
}

async function updateDb(dbKey, id, data) {
  const stringifiedData = JSON.stringify(data);
  await db_client.hSet(dbKey, id, stringifiedData);
  return data;
}

async function invalidateCache(cacheKey) {
  await cache_client.del(cacheKey);
  console.log(`Cache invalidated for ${cacheKey}`);
}

export const redis = {
  cache_client,
  db_client,
  getFromCache,
  getSingleFromCache,
  updateDb,
  invalidateCache
};
