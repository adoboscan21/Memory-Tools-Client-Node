import MemoryToolsClient from "./memory-tools-client.js"; // Ensure the path is correct

// Database host and port configuration.
const DB_HOST = "127.0.0.1"; // Or your remote server's IP/hostname
const DB_PORT = 8080; // Your Go DB server's TLS socket port
// Path to the server's public certificate
const SERVER_CERT_PATH = "certificates/server.crt"; // Ensure this path is correct

async function runTest() {
  let client = null; // Declare client outside try to ensure it's accessible in finally

  try {
    // --- 1. Failed Authentication Test ---
    console.log(
      "--- Test: Failed Authentication (incorrect username/password) ---"
    );
    client = new MemoryToolsClient(
      DB_HOST,
      DB_PORT,
      "admin",
      "wrongpass",
      null,
      false
    );
    try {
      await client.connect();
      console.log(
        "ERROR: Connection should have failed due to authentication."
      );
    } catch (error) {
      console.log(`Authentication failed (expected): ${error.message}`);
    } finally {
      client.close(); // Close this client instance
    }

    console.log("\n--- Test: Operations as 'admin' User ---"); // --- 2. Successful Connection and Authentication (Admin user) --- // Instantiate client with admin credentials
    client = new MemoryToolsClient(
      DB_HOST,
      DB_PORT,
      "admin",
      "adminpass",
      null,
      false
    );
    await client.connect();
    console.log(
      `Connected and authenticated as: ${client.getAuthenticatedUsername()}`
    );
    console.log(
      `Session authentication status: ${client.isSessionAuthenticated()}`
    ); // --- Main Store Operations (as admin) ---

    console.log("\n--- Main Store SET (admin) ---");
    let startTime = performance.now();
    let setMsg = await client.set(
      "myNodeKey",
      { message: "Hello from Node.js admin!", timestamp: Date.now() },
      300
    );
    let endTime = performance.now();
    console.log(`${setMsg} (Time: ${(endTime - startTime).toFixed(2)} ms)`);

    console.log("\n--- Main Store GET (admin) ---");
    startTime = performance.now();
    let getResult = await client.get("myNodeKey");
    endTime = performance.now();
    if (getResult.found) {
      console.log(
        `${JSON.stringify(getResult.value)} (Time: ${(
          endTime - startTime
        ).toFixed(2)} ms)`
      );
    } else {
      console.log(
        `${getResult.message} (Time: ${(endTime - startTime).toFixed(2)} ms)`
      );
    } // --- Collection Operations (as admin) ---

    console.log("\n--- Collection Create (admin) ---");
    startTime = performance.now();
    let createMsg = await client.collectionCreate("node_app_data"); // Using a different name to avoid conflicts if it already exists
    endTime = performance.now();
    console.log(`${createMsg} (Time: ${(endTime - startTime).toFixed(2)} ms)`);

    console.log("\n--- Collection List (admin) ---");
    startTime = performance.now();
    let listResult = await client.collectionList();
    endTime = performance.now();
    console.log(
      `${JSON.stringify(listResult.names)} (Time: ${(
        endTime - startTime
      ).toFixed(2)} ms)`
    ); // Expected: ["node_app_data", "_system"] (order may vary)
    console.log("\n--- Collection Item Set (admin) ---");
    startTime = performance.now();
    let itemSetMsg = await client.collectionItemSet(
      "node_app_data",
      "data_entry_1",
      { content: "Some data from admin", version: 1 },
      3600
    );
    endTime = performance.now();
    console.log(`${itemSetMsg} (Time: ${(endTime - startTime).toFixed(2)} ms)`); // --- Test: Restricted access to _system as 'admin' (SHOULD FAIL) ---

    console.log(
      "\n--- Test: List '_system' Collection as 'admin' (Should fail) ---"
    );
    try {
      let systemListResult = await client.collectionItemList("_system");
      console.log(
        "ERROR: Admin unexpectedly listed '_system':",
        systemListResult.items
      );
    } catch (error) {
      console.log(
        `Admin could not list '_system' (expected): ${error.message}`
      );
    }

    console.log(
      "\n--- Test: Get Item from '_system' as 'admin' (Should fail) ---"
    );
    try {
      let systemGetResult = await client.collectionItemGet(
        "_system",
        "user:admin"
      );
      console.log(
        "ERROR: Admin unexpectedly got item from '_system':",
        systemGetResult.value
      );
    } catch (error) {
      console.log(
        `Admin could not get item from '_system' (expected): ${error.message}`
      );
    }

    client.close(); // Close admin session

    console.log(
      "\n--- Test: Operations as 'root' User (requires localhost) ---"
    ); // --- 3. Successful Connection and Authentication (Root user) --- // Instantiate client with root credentials. ASSUMES YOU ARE ON LOCALHOST.
    client = new MemoryToolsClient(
      DB_HOST,
      DB_PORT,
      "root",
      "rootpass",
      null,
      false
    );
    await client.connect();
    console.log(
      `Connected and authenticated as: ${client.getAuthenticatedUsername()}`
    );
    console.log(
      `Session authentication status: ${client.isSessionAuthenticated()}`
    ); // --- Test: List '_system' Collection as 'root' (SHOULD WORK) ---

    console.log(
      "\n--- Test: List '_system' Collection as 'root' (Should work) ---"
    );
    startTime = performance.now(); // Specify type for better handling of user data
    let systemListRootResult = await client.collectionItemList("_system");
    endTime = performance.now();
    console.log(
      `${JSON.stringify(systemListRootResult.items, null, 2)} (Time: ${(
        endTime - startTime
      ).toFixed(2)} ms)`
    ); // Should show username and is_root for 'admin' and 'root'
    console.log(
      "\n--- Test: Get Item from '_system' as 'root' (Should work) ---"
    );
    startTime = performance.now();
    let systemGetRootResult = await client.collectionItemGet(
      "_system",
      "user:admin"
    );
    endTime = performance.now();
    if (systemGetRootResult.found) {
      console.log(
        `${JSON.stringify(systemGetRootResult.value)} (Time: ${(
          endTime - startTime
        ).toFixed(2)} ms)`
      );
    } else {
      console.log(
        `${systemGetRootResult.message} (Time: ${(endTime - startTime).toFixed(
          2
        )} ms)`
      );
    } // --- Final Cleanup ---

    console.log("\n--- Cleanup: Collection Delete (admin) ---");
    startTime = performance.now();
    let deleteMsg = await client.collectionDelete("node_app_data");
    endTime = performance.now();
    console.log(`${deleteMsg} (Time: ${(endTime - startTime).toFixed(2)} ms)`);
  } catch (error) {
    console.error("\n--- UNEXPECTED ERROR DURING TESTS ---");
    console.error(error);
  } finally {
    // Ensures the client socket is closed after tests or errors.
    if (client && client.socket && !client.socket.destroyed) {
      client.close(); // Use the class's close method
    }
    console.log("\n--- Test finished ---");
  }
}

runTest();
