import assert from "node:assert";
import { randomUUID } from "node:crypto";
import MemoryToolsClient from "../memory-tools-client.js";

// --- Test Environment Configuration ---
// Modify these variables if your server runs in another location or with different credentials
const HOST = "localhost";
const PORT = 5876;
const USERNAME = "admin"; // A user with write permissions on '*'
const PASSWORD = "adminpass";
const SERVER_CERT_PATH = undefined; // Path to the server's certificate or undefined
const REJECT_UNAUTHORIZED = false;

// --- Helper Functions for Printing ---

function printHeader(title) {
  console.log("\n" + "=".repeat(60));
  console.log(`--- ${title.toUpperCase()} ---`);
  console.log("=".repeat(60));
}

function printStep(step, description) {
  console.log(`\n${step}. ${description}...`);
}

/**
 * A helper to wrap test promises, printing success or failure.
 * In Node.js, the client throws an error on failure, which is caught here.
 */
async function checkResult(description, promiseFn) {
  try {
    const result = await promiseFn();
    console.log(`   [SUCCESS]   ${description}`);
    if (result !== undefined && result !== null) {
      // Pretty-print if it looks like an object/array
      if (typeof result === "object") {
        console.log(`   [DATA]      ${JSON.stringify(result, null, 2)}`);
      } else {
        console.log(`   [DATA]      ${result}`);
      }
    }
    return result;
  } catch (error) {
    console.error(`   [FAILURE]   ${description}`);
    console.error(`   [ERROR]     ${error.message}`);
    // Exit the process on critical failure to avoid cascading errors
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const client = new MemoryToolsClient(
    HOST,
    PORT,
    USERNAME,
    PASSWORD,
    SERVER_CERT_PATH,
    REJECT_UNAUTHORIZED
  );

  try {
    await client.connect();
    if (!client.isAuthenticatedSession) {
      console.error(
        "[FAILURE] Initial client authentication failed. Aborting tests."
      );
      return;
    }

    // --- Collections and Indexes Test ---
    await runCollectionAndIndexTests(client);

    // --- CRUD Operations Test ---
    await runCrudTests(client);

    // --- Bulk Operations Test ---
    await runBulkTests(client);

    // --- Transactions Test ---
    await runTransactionTests(client);

    // --- Complex Queries Test ---
    await runQueryTests(client);
  } catch (e) {
    console.error(`\n\nAn unexpected error occurred during tests: ${e.message}`);
  } finally {
    client.close();
    console.log("\nConnection closed.");
  }
}

async function runCollectionAndIndexTests(client) {
  printHeader("Collection and Index Management Tests");
  const collName = `test_coll_${randomUUID().slice(0, 8)}`;

  try {
    await checkResult("Creating collection", () =>
      client.collectionCreate(collName)
    );

    printStep(2, "Listing collections to verify creation");
    const collections = await client.collectionList();
    if (collections.includes(collName)) {
      console.log(`   [SUCCESS]   Collection '${collName}' was found in the list.`);
    } else {
      console.error(`   [FAILURE]   Collection '${collName}' was NOT found.`);
    }

    await checkResult("Creating an index on the 'city' field", () =>
      client.collectionIndexCreate(collName, "city")
    );

    printStep(4, "Listing indexes to verify creation");
    const indexes = await client.collectionIndexList(collName);
    if (indexes.includes("city")) {
      console.log("   [SUCCESS]   The 'city' index was found.");
    } else {
      console.error("   [FAILURE]   The 'city' index was NOT found.");
    }

    await checkResult("Deleting the 'city' index", () =>
      client.collectionIndexDelete(collName, "city")
    );

    printStep(6, "Listing indexes to verify deletion");
    const indexesAfterDelete = await client.collectionIndexList(collName);
    if (!indexesAfterDelete.includes("city")) {
      console.log("   [SUCCESS]   The 'city' index no longer exists.");
    } else {
      console.error("   [FAILURE]   The 'city' index still exists.");
    }
  } finally {
    printStep(7, `Cleanup: deleting collection '${collName}'`);
    await client.collectionDelete(collName);
  }
}

async function runCrudTests(client) {
  printHeader("CRUD Operations Tests (Create, Read, Update, Delete)");
  const collName = `crud_coll_${randomUUID().slice(0, 8)}`;
  const itemKey = "user-001";

  try {
    await client.collectionCreate(collName);

    await checkResult("SET (Create) an item", () =>
      client.collectionItemSet(collName, { name: "Luisa", age: 40 }, itemKey)
    );

    printStep(2, "GET (Read) the item");
    const getResp = await client.collectionItemGet(collName, itemKey);
    assert(getResp.found, "Item should be found");
    assert.strictEqual(getResp.value.name, "Luisa");
    console.log("   [SUCCESS]   Item was retrieved correctly.");

    await checkResult("UPDATE the item", () =>
      client.collectionItemUpdate(collName, itemKey, {
        age: 41,
        status: "active",
      })
    );

    printStep(4, "GET (Read) to verify the update");
    const getUpdatedResp = await client.collectionItemGet(collName, itemKey);
    assert(getUpdatedResp.found, "Updated item should be found");
    assert.strictEqual(getUpdatedResp.value.age, 41);
    console.log("   [SUCCESS]   Item was updated correctly.");

    await checkResult("DELETE the item", () =>
      client.collectionItemDelete(collName, itemKey)
    );

    printStep(6, "GET (Read) to verify the deletion");
    const getDeletedResp = await client.collectionItemGet(collName, itemKey);
    if (!getDeletedResp.found) {
      console.log(`   [SUCCESS]   Item '${itemKey}' was not found, as expected.`);
    } else {
      console.error(`   [FAILURE]   Item '${itemKey}' still exists.`);
    }
  } finally {
    await client.collectionDelete(collName);
  }
}

async function runBulkTests(client) {
  printHeader("Bulk Operations Tests (set_many, delete_many)");
  const collName = `bulk_coll_${randomUUID().slice(0, 8)}`;

  try {
    await client.collectionCreate(collName);

    const itemsToSet = Array.from({ length: 5 }, (_, i) => ({
      _id: `item-${i}`,
      val: i * 10,
    }));
    const keysToDelete = ["item-1", "item-3"];

    await checkResult("SET MANY: Inserting 5 items", () =>
      client.collectionItemSetMany(collName, itemsToSet)
    );

    await checkResult("DELETE MANY: Deleting 2 out of 5 items", () =>
      client.collectionItemDeleteMany(collName, keysToDelete)
    );

    await sleep(100); // Give the server time to stabilize state

    printStep(3, "Verifying the final state");
    const finalItems = await client.collectionQuery(collName, {});
    const finalKeys = new Set(finalItems.map((item) => item._id));
    const expectedKeys = new Set(["item-0", "item-2", "item-4"]);

    try {
      assert.deepStrictEqual(finalKeys, expectedKeys);
      console.log("   [SUCCESS]   The collection's state is as expected.");
    } catch (e) {
      console.error("   [FAILURE]   The final state is not correct.");
      console.error(`             - Expected: ${[...expectedKeys].join(", ")}`);
      console.error(`             - Found:    ${[...finalKeys].join(", ")}`);
    }
  } finally {
    await client.collectionDelete(collName);
  }
}

async function runTransactionTests(client) {
  printHeader("Transaction Tests (Commit and Rollback)");
  const collName = `tx_coll_${randomUUID().slice(0, 8)}`;
  const keyCommit = "committed-key";
  const keyRollback = "rolled-back-key";

  try {
    await client.collectionCreate(collName);

    printStep(1, "Testing a successful COMMIT");
    await client.begin();
    await client.collectionItemSet(collName, { tx_status: "final" }, keyCommit);
    await client.commit();
    const getCommitted = await client.collectionItemGet(collName, keyCommit);
    if (getCommitted.found) {
      console.log(
        "   [SUCCESS]   The item written in the transaction was found after commit."
      );
    } else {
      console.error("   [FAILURE]   The item was not found after commit.");
    }

    printStep(2, "Testing a ROLLBACK");
    await client.begin();
    await client.collectionItemSet(
      collName,
      { tx_status: "temporary" },
      keyRollback
    );
    await client.rollback();
    const getRolledBack = await client.collectionItemGet(collName, keyRollback);
    if (!getRolledBack.found) {
      console.log(
        "   [SUCCESS]   The item written in the transaction was not found after rollback, as expected."
      );
    } else {
      console.error(
        "   [FAILURE]   An item that should have been rolled back was found."
      );
    }
  } finally {
    await client.collectionDelete(collName);
  }
}

async function runQueryTests(client) {
  printHeader("Query Tests (Filter, Projection, Lookup)");
  const usersColl = `users_${randomUUID().slice(0, 8)}`;
  const profilesColl = `profiles_${randomUUID().slice(0, 8)}`;

  try {
    await client.collectionCreate(usersColl);
    await client.collectionCreate(profilesColl);

    const users = [
      { _id: "u1", name: "Elena", age: 34, active: true },
      { _id: "u2", name: "Marcos", age: 25, active: true },
      { _id: "u3", name: "Sofia", age: 45, active: false },
    ];
    const profiles = [
      { _id: "p1", user_id: "u1", city: "Madrid" },
      { _id: "p2", user_id: "u2", city: "Bogota" },
    ];
    await client.collectionItemSetMany(usersColl, users);
    await client.collectionItemSetMany(profilesColl, profiles);
    await sleep(100); // Give the server time to process writes

    printStep(1, "Query with Filter: active users with age > 30");
    const qFilter = {
      filter: {
        and: [
          { field: "active", op: "=", value: true },
          { field: "age", op: ">", value: 30 },
        ],
      },
    };
    const result1 = await checkResult("Executing filter query", () =>
      client.collectionQuery(usersColl, qFilter)
    );
    assert.strictEqual(result1.length, 1);
    assert.strictEqual(result1[0].name, "Elena");

    printStep(2, "Query with Projection: get only name and age");
    const qProj = { projection: ["name", "age"] };
    const result2 = await checkResult("Executing projection query", () =>
      client.collectionQuery(usersColl, qProj)
    );
    assert(result2.every((user) => !("active" in user)));
    assert(result2.every((user) => "name" in user && "age" in user));

    printStep(3, "Query with Lookup (JOIN): join profiles with users");
    const qLookup = {
      lookups: [
        {
          from: usersColl,
          localField: "user_id",
          foreignField: "_id",
          as: "user_info",
        },
      ],
    };
    const result3 = await checkResult("Executing lookup query", () =>
      client.collectionQuery(profilesColl, qLookup)
    );
    const profile1 = result3.find((p) => p._id === "p1");
    assert(profile1, "Profile p1 should exist");
    assert.strictEqual(profile1.user_info.name, "Elena");
  } finally {
    await client.collectionDelete(usersColl);
    await client.collectionDelete(profilesColl);
  }
}

console.log("Starting test suite for MemoryToolsClient...");
main().catch((err) => {
  console.error("\nA critical error stopped the test suite:", err);
});