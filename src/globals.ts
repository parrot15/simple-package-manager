import { LRUCache } from "lru-cache";
import { PackageInfo } from "./types";

// Use in-memory caches to store results of network requests.

const cacheOptions = {
  max: 500, // Max size of cache.
};

// Cache results of requests to NPM registry for package version data.
export const packageVersionCache = new LRUCache<string, string>(cacheOptions);

// Cache results of requests to NPM registry for package metadata.
export const packageInfoCache = new LRUCache<string, PackageInfo>(cacheOptions);
