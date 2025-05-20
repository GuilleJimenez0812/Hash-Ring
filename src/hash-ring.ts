// src/HashRing.ts
import { createHash } from 'crypto';

/**
 * Generic class that implements a hash ring (consistent hashing).
 * @typeParam T — type of the nodes to be inserted into the ring.
 */
export class HashRing<T> {
  private ring: string[] = [];
  private nodesMap = new Map<string, T>();
  private replicas: number;
  private hashFn: (key: string) => string;

  /**
   * @param nodes     Initial list of nodes.
   * @param replicas  Number of virtual replicas per node (default 50).
   * @param hashFn    Hash function (default SHA-256 hex).
   */
  constructor(
    nodes: T[] = [],
    replicas = 50,
    hashFn: (key: string) => string = (key) =>
      createHash('sha256').update(key).digest('hex')
  ) {
    this.replicas = replicas;
    this.hashFn = hashFn;
    nodes.forEach((n) => this.addNode(n));
  }

  /** Adds a node and its replicas to the ring. */
  addNode(node: T): void {
    for (let i = 0; i < this.replicas; i++) {
      const vNodeKey = `${String(node)}:${i}`;
      const digest = this.hashFn(vNodeKey);
      this.ring.push(digest);
      this.nodesMap.set(digest, node);
    }
    this.ring.sort(); // For hex strings, lexicographical order = numerical order
  }

  /** Removes a node and all its replicas. */
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
   * Given a key (string), returns the corresponding node T.
   * If there are no nodes, returns `undefined`.
   */
  getNode(key: string): T | undefined {
    if (!this.ring.length) return undefined;
    const digest = this.hashFn(key);
    let idx = this.binarySearch(digest);
    if (idx === this.ring.length) idx = 0; // wrap-around
    const nodeHash = this.ring[idx];
    return this.nodesMap.get(nodeHash);
  }

  /** Binary search to find the first index with hash ≥ target */
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

  /** Number of "physical" nodes in the ring */
  getNodesCount(): number {
    return this.ring.length / this.replicas;
  }
}
