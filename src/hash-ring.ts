// src/HashRing.ts
import { createHash } from 'crypto';

/**
 * ## Description
 * Generic class that implements a hash ring (consistent hashing).
 *
 * ## Params
 * @param {T[]} nodes     - Initial list of nodes.
 * @param {number} replicas - Number of virtual replicas per node (default 50).
 * @param {(key: string) => string} hashFn
 *   - Hash function mapping a key to a hex digest (default SHA-256).
 * @param {(a: string, b: string) => number} [sortFn]
 *   - Optional comparator for sorting the ring.
 *
 * ## Returns
 * @returns {HashRing<T>}
 *   A new instance of HashRing.
 */
export class HashRing<T> {
  private ring: string[] = [];
  private nodesMap = new Map<string, T>();
  private replicas: number;
  private hashFn: (key: string) => string;
  private sortFn?: (a: string, b: string) => number;

  /**
   * @param nodes     Initial list of nodes.
   * @param replicas  Number of virtual replicas per node (default 50).
   * @param hashFn    Hash function (default SHA-256 hex).
   * @param sortFn   Optional sorting function for the ring.
   */
  constructor(
    nodes: T[] = [],
    replicas = 50,
    hashFn: (key: string) => string = (key) =>
      createHash('sha256').update(key).digest('hex'),
    sortFn?: (a: string, b: string) => number
  ) {
    this.replicas = replicas;
    this.hashFn = hashFn;
    this.sortFn = sortFn;
    nodes.forEach((n) => this.addNode(n));
  }

  /**
   * ## Description
   * Adds a node and its virtual replicas to the ring.
   *
   * ## Params
   * @param {T} node
   *   The physical node to add.
   *
   * ## Returns
   * @returns {void}
   */
  addNode(node: T): void {
    for (let i = 0; i < this.replicas; i++) {
      const vNodeKey = `${String(node)}:${i}`;
      const digest = this.hashFn(vNodeKey);
      this.ring.push(digest);
      this.nodesMap.set(digest, node);
    }
    if (this.sortFn) this.ring.sort(this.sortFn);
    this.ring.sort(); // For hex strings, lexicographical order = numerical order
  }

  /**
   * ## Description
   * Removes a node and all its virtual replicas from the ring.
   *
   * ## Params
   * @param {T} node
   *   The physical node to remove.
   *
   * ## Returns
   * @returns {void}
   */
  removeNode(node: T): void {
    for (let i = 0; i < this.replicas; i++) {
      const vNodeKey = `${String(node)}:${i}`;
      const digest = this.hashFn(vNodeKey);
      const idx = this.ring.indexOf(digest);
      if (idx !== -1) this.ring.splice(idx, 1);
      this.nodesMap.delete(digest);
    }
  }

  /**
   * ## Description
   * Given a key, returns the corresponding node according to consistent hashing.
   *
   * ## Params
   * @param {string} key
   *   The key to map to a node.
   *
   * ## Returns
   * @returns {T | undefined}
   *   The node responsible for the given key, or `undefined` if the ring is empty.
   */
  getNode(key: string): T | undefined {
    if (!this.ring.length) return undefined;
    const digest = this.hashFn(key);
    let idx = this.binarySearch(digest);
    if (idx === this.ring.length) idx = 0; // wrap-around
    const nodeHash = this.ring[idx];
    return this.nodesMap.get(nodeHash);
  }

  /**
   * ## Description
   * Binary search to find the first index with hash ≥ target.
   *
   * ## Params
   * @param {string} target
   *   The target hash value.
   *
   * ## Returns
   * @returns {number}
   *   Index of the matching or insertion point.
   */
  private binarySearch(target: string): number {
    let lo = 0,
      hi = this.ring.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid] === target) return mid;
      if (this.ring[mid] < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * ## Description
   * Returns the number of physical nodes in the ring.
   *
   * ## Returns
   * @returns {number}
   *   Count of unique physical nodes.
   */
  getNodesCount(): number {
    return this.ring.length / this.replicas;
  }
}
