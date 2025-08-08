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
     * @param rejectUnauthorized If `False`, disables certificate verification (not for production). Defaults to `True`.
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

    /** Ensures a collection with the given name exists. */
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

    /** Sets an item (JSON document) within a collection. */
    public collectionItemSet<T = any>(
      collectionName: string,
      key: string,
      value: T,
      ttlSeconds?: number
    ): Promise<string>;

    /** Sets multiple items from a list of dictionaries in a single batch operation. */
    public collectionItemSetMany<T extends { _id?: string }>(
      collectionName: string,
      items: T[]
    ): Promise<string>;

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
