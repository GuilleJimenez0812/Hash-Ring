import { createHash } from 'crypto';

type TreeNode<H> = {
  value: string;
  left?: TreeNode<H>;
  right?: TreeNode<H>;
};

/**
 * HashRing implements consistent hashing for distributed systems.
 * It maps keys to nodes in a way that minimizes remapping when nodes are added or removed.
 *
 * @template T - The type of nodes stored in the hash ring
 * @template H - The type of hash values (default: string)
 *
 * @example
 * ```typescript
 * Create a hash ring with string nodes
 * const ring = new HashRing<string>(['server1', 'server2', 'server3']);
 *
 * Get the node responsible for a key
 * const node = ring.getNode('user:123'); // Returns 'server1', 'server2', or 'server3'
 *
 * Add a new node
 * ring.addNode('server4');
 *
 * Remove a node
 * ring.removeNode('server2');
 * ```
 */
export default class HashRing<T, H = string> {
  private root?: TreeNode<H>;
  private nodesMap = new Map<string, T>();
  private replicas: number;
  private hashFn: (key: string) => string;
  private sortFn?: (a: string, b: string) => number;
  private nodeToString: (node: T) => string;

  /**
   * Creates a new HashRing instance.
   *
   * @param nodes - Initial array of nodes to add to the ring
   * @param replicas - Number of virtual nodes per physical node (default: 50). More replicas provide better distribution
   * @param hashFn - Hash function to map keys to positions on the ring (default: SHA256)
   * @param sortFn - Optional custom sort function for hash values. Required when using numeric hashes
   * @param nodeToString - Optional function to convert nodes to string keys. Defaults to toString() or JSON.stringify()
   */
  constructor(
    nodes: T[] = [],
    replicas = 50,
    hashFn: (key: string) => string = (key) =>
      createHash('sha256').update(key).digest('hex'),
    sortFn?: (a: string, b: string) => number,
    nodeToString?: (node: T) => string
  ) {
    this.replicas = replicas;
    this.hashFn = hashFn;
    this.sortFn = sortFn;
    this.nodeToString =
      nodeToString ||
      ((node: T) => {
        if (typeof node === 'string') return node;
        if (typeof node === 'object' && node !== null && 'toString' in node) {
          return (node as any).toString();
        }
        return JSON.stringify(node);
      });
    nodes.forEach((n) => this.addNode(n));
  }

  /**
   * Adds a node to the hash ring.
   * Creates multiple virtual nodes (replicas) for better key distribution.
   *
   * @param node - The node to add to the ring
   */
  public addNode(node: T): void {
    for (let i = 0; i < this.replicas; i++) {
      const virtualNodeKey = `${this.nodeToString(node)}:${i}`;
      const digest = this.hashFn(virtualNodeKey);
      this.root = this.insertNode(this.root, digest);
      this.nodesMap.set(digest, node);
    }
  }

  /**
   * Removes a node from the hash ring.
   * Removes all virtual nodes (replicas) associated with this node.
   *
   * @param node - The node to remove from the ring
   */
  public removeNode(node: T): void {
    for (let i = 0; i < this.replicas; i++) {
      const virtualNodeKey = `${this.nodeToString(node)}:${i}`;
      const digest = this.hashFn(virtualNodeKey);
      this.root = this.deleteNode(this.root, digest);
      this.nodesMap.delete(digest);
    }
  }

  /**
   * Gets the node responsible for a given key.
   * Uses consistent hashing to find the node that owns the key.
   *
   * @param key - The key to look up
   * @returns The node responsible for the key, or undefined if the ring is empty
   */
  public getNode(key: string): T | undefined {
    if (!this.root) return undefined;
    const digest = this.hashFn(key);
    const successor = this.findSuccessor(this.root, digest);
    const target = successor ? successor.value : this.minNode(this.root)!.value;
    return this.nodesMap.get(target);
  }

  /**
   * Returns all hash ranges owned by a particular node, including virtual replicas.
   * Each range is [start, end], where 'end' is the node's digest and 'start' is
   * the previous digest on the ring. Ranges can wrap around (start > end).
   *
   * @param node - The node to get ranges for
   * @returns Array of ranges owned by the node. Each range has start and end hash values
   */
  public getRangesForNode(node: T): { start: string; end: string }[] {
    const all = this.getSortedDigests();

    // Find all digests that belong to this node
    const nodeStr = this.nodeToString(node);
    const nodeDigests: string[] = [];

    for (let i = 0; i < this.replicas; i++) {
      const virtualNodeKey = `${nodeStr}:${i}`;
      const digest = this.hashFn(virtualNodeKey);
      if (this.nodesMap.has(digest)) {
        nodeDigests.push(digest);
      }
    }

    // Sort the digests
    nodeDigests.sort(this.sortFn ?? ((a, b) => a.localeCompare(b)));

    return nodeDigests.map((end) => {
      const idx = all.indexOf(end);
      const start = idx > 0 ? all[idx - 1] : all[all.length - 1];
      return { start, end };
    });
  }

  /**
   * Given a range [start, end], returns the node that owns this specific range.
   * This is used to find which node owns a particular virtual node position.
   * Ownership is determined by the 'end' hash in the ring.
   *
   * @param range - The range object with start and end hash values
   * @returns The node that owns this specific range, or undefined if not found
   */
  public getNodeForRange(range: { start: string; end: string }): T | undefined {
    return this.nodesMap.get(range.end);
  }

  /**
   * Finds all nodes that have ownership of any part of the given range.
   * This handles wrap-around ranges where start > end.
   *
   * @param start - The starting hash value of the range
   * @param end - The ending hash value of the range
   * @returns Array of unique nodes that own parts of the specified range
   */
  public getNodesInRange(start: string, end: string): T[] {
    const all = this.getSortedDigests();
    const uniqueNodes = new Set<T>();

    if (all.length === 0) return [];

    const cmp = this.sortFn ?? ((a, b) => a.localeCompare(b));
    const isWraparound = cmp(start, end) > 0;

    for (const digest of all) {
      let inRange = false;

      if (isWraparound) {
        // Range wraps around: includes values >= start OR <= end
        inRange = cmp(digest, start) >= 0 || cmp(digest, end) <= 0;
      } else {
        // Normal range: includes values >= start AND <= end
        inRange = cmp(digest, start) >= 0 && cmp(digest, end) <= 0;
      }

      if (inRange) {
        const node = this.nodesMap.get(digest);
        if (node !== undefined) {
          uniqueNodes.add(node);
        }
      }
    }

    return Array.from(uniqueNodes);
  }

  /**
   * Gets the number of physical nodes in the ring.
   *
   * @returns The count of unique nodes (not including virtual replicas)
   */
  public getNodesCount(): number {
    return this.nodesMap.size / this.replicas;
  }

  // --- private helpers ---

  /**
   * Performs in-order traversal to collect all hash digests in sorted order.
   *
   * @returns Array of hash values in ascending order
   */
  private getSortedDigests(): string[] {
    const result: string[] = [];
    (function inOrder(n: TreeNode<H> | undefined) {
      if (!n) return;
      inOrder(n.left);
      result.push(n.value);
      inOrder(n.right);
    })(this.root);
    return result;
  }

  /**
   * Inserts a value into the binary search tree.
   *
   * @param node - Current tree node
   * @param value - Hash value to insert
   * @returns The updated tree node
   */
  private insertNode(
    node: TreeNode<H> | undefined,
    value: string
  ): TreeNode<H> {
    if (!node) return { value };
    const cmp = this.sortFn
      ? this.sortFn(value, node.value)
      : value.localeCompare(node.value);
    if (cmp < 0) node.left = this.insertNode(node.left, value);
    else node.right = this.insertNode(node.right, value);
    return node;
  }

  /**
   * Deletes a value from the binary search tree.
   *
   * @param node - Current tree node
   * @param value - Hash value to delete
   * @returns The updated tree node or undefined if deleted
   */
  private deleteNode(
    node: TreeNode<H> | undefined,
    value: string
  ): TreeNode<H> | undefined {
    if (!node) return;
    const cmp = this.sortFn
      ? this.sortFn(value, node.value)
      : value.localeCompare(node.value);
    if (cmp < 0) {
      node.left = this.deleteNode(node.left, value);
    } else if (cmp > 0) {
      node.right = this.deleteNode(node.right, value);
    } else {
      if (!node.left) return node.right;
      if (!node.right) return node.left;
      const successor = this.minNode(node.right);
      node.value = successor.value;
      node.right = this.deleteNode(node.right, successor.value);
    }
    return node;
  }

  /**
   * Finds the minimum node in a subtree.
   *
   * @param node - Root of the subtree
   * @returns The node with the minimum value
   */
  private minNode(node: TreeNode<H>): TreeNode<H> {
    return node.left ? this.minNode(node.left) : node;
  }

  /**
   * Finds the first node with value greater than or equal to target.
   * Used to find the node responsible for a key in the ring.
   *
   * @param node - Current tree node
   * @param target - Target hash value to find successor for
   * @param successor - Current best successor found
   * @returns The successor node or undefined if none found
   */
  private findSuccessor(
    node: TreeNode<H> | undefined,
    target: string,
    successor?: TreeNode<H>
  ): TreeNode<H> | undefined {
    if (!node) return successor;
    if (node.value === target) return node;
    const cmp = this.sortFn
      ? this.sortFn(node.value, target)
      : node.value.localeCompare(target);
    if (cmp > 0) {
      return this.findSuccessor(node.left, target, node);
    } else {
      return this.findSuccessor(node.right, target, successor);
    }
  }
}
