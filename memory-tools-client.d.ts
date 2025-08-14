// memory-tools-client.d.ts
declare module "memory-tools-client" {
  import * as tls from "node:tls";

  // --- Interfaces for results---

  /** Represents the result of a get operation on a single item. */
  export interface GetResult<T = any> {
    found: boolean;
    message: string;
    value: T | null;
  }

  // --- Interfaces for queries ---

  export interface OrderByClause {
    field: string;
    direction: "asc" | "desc";
  }

  export interface Aggregation {
    func: "sum" | "avg" | "min" | "max" | "count";
    field: string;
  }

  export interface LookupClause {
    from: string;
    localField: string;
    foreignField: string;
    as: string;
  }

  export interface Query {
    filter?: { [key: string]: any };
    order_by?: OrderByClause[];
    limit?: number;
    offset?: number;
    count?: boolean;
    aggregations?: { [key: string]: Aggregation };
    group_by?: string[];
    having?: { [key: string]: any };
    distinct?: string;
    projection?: string[];
    lookups?: LookupClause[];
  }

  // --- Main Client Class ---

  export class MemoryToolsClient {
    /**
     * Creates a new client instance.
     * @param host Server IP address or hostname.
     * @param port Server TLS port.
     * @param username Optional username for authentication.
     * @param password Optional password for authentication.
     * @param serverCertPath Optional path to the server's CA certificate for verification.
     * @param rejectUnauthorized If `false`, disables certificate verification (not recommended for production). Defaults to `true`.
     */
    constructor(
      host: string,
      port: number,
      username?: string,
      password?: string,
      serverCertPath?: string,
      rejectUnauthorized?: boolean
    );

    /** Indicates if the client session is currently authenticated. */
    public readonly isAuthenticatedSession: boolean;

    /** The username of the authenticated user, or null. */
    public readonly authenticatedUser: string | null;

    /** Establishes a TLS connection and authenticates. */
    public connect(): Promise<tls.TLSSocket>;

    /** Closes the connection to the server. */
    public close(): void;

    // --- Transaction Methods ---

    /**
     * Starts a new transaction.
     * All subsequent commands will be part of this transaction until `commit` or `rollback` is called.
     */
    public begin(): Promise<string>;

    /**
     * Commits the current active transaction, making all its changes permanent.
     */
    public commit(): Promise<string>;

    /**
     * Rolls back the current active transaction, discarding all its changes.
     */
    public rollback(): Promise<string>;

    // --- Collection & Index Methods ---

    /** Creates a new collection. */
    public collectionCreate(collectionName: string): Promise<string>;

    /** Deletes an entire collection and all of its items. */
    public collectionDelete(collectionName: string): Promise<string>;

    /** Lists the names of all collections the current user can access. */
    public collectionList(): Promise<string[]>;

    /** Creates an index on a field to speed up queries. */
    public collectionIndexCreate(
      collectionName: string,
      fieldName: string
    ): Promise<string>;

    /** Deletes an index from a field. */
    public collectionIndexDelete(
      collectionName: string,
      fieldName: string
    ): Promise<string>;

    /** Returns a list of indexed fields for a collection. */
    public collectionIndexList(collectionName: string): Promise<string[]>;

    // --- Item (CRUD) Methods ---

    /**
     * Sets an item (JSON document) within a collection.
     * If `key` is not provided, the server will generate a unique UUID.
     *
     * @param collectionName The name of the collection.
     * @param value The document to store.
     * @param key (Optional) The unique key for the item. If not provided, the server generates one.
     * @param ttlSeconds (Optional) Time-to-live in seconds. Defaults to 0 (no expiry).
     * @returns The created document, including the server-generated `_id` if applicable.
     */
    public collectionItemSet<T = any>(
      collectionName: string,
      value: T,
      key?: string,
      ttlSeconds?: number
    ): Promise<T>;

    /**
     * Sets multiple items in a single batch operation.
     * The server will assign a UUID to any item that does not have an `_id` field.
     * @returns An array of the created documents, including server-generated `_id`s.
     */
    public collectionItemSetMany<T extends { _id?: string }>(
      collectionName: string,
      items: T[]
    ): Promise<T[]>;

    /** Partially updates an existing item. Only the fields in `patchValue` will be added or overwritten. */
    public collectionItemUpdate<T = any>(
      collectionName: string,
      key: string,
      patchValue: Partial<T>
    ): Promise<string>;

    /** Partially updates multiple items in a single batch. */
    public collectionItemUpdateMany<T = any>(
      collectionName: string,
      items: { _id: string; patch: Partial<T> }[]
    ): Promise<string>;

    /** Retrieves a single item from a collection. */
    public collectionItemGet<T = any>(
      collectionName: string,
      key: string
    ): Promise<GetResult<T>>;

    /** Deletes a single item from a collection by its key. */
    public collectionItemDelete(
      collectionName: string,
      key: string
    ): Promise<string>;

    /** Deletes multiple items from a collection by their keys in a single batch. */
    public collectionItemDeleteMany(
      collectionName: string,
      keys: string[]
    ): Promise<string>;

    /** Executes a complex query on a collection. */
    public collectionQuery<T = any>(
      collectionName: string,
      query: Query
    ): Promise<T>;
  }

  export default MemoryToolsClient;
}