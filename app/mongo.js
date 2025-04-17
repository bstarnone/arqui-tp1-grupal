import { MongoClient } from "mongodb";

const client = new MongoClient("mongodb://mongodb:27017");

await client.connect();

const db = client.db("arvault-db");

export const accounts = db.collection("accounts");
export const rates = db.collection("rates");
export const log = db.collection("log");

export const closeConnection = async () => {
  await client.close();
};
