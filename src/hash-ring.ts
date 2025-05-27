import { createHash } from 'crypto';

/**
 * Binary tree node for storing hash values in sorted order.
 * Used internally for efficient range queries and successor finding.
 *
 * @template H - The type of hash values stored in the tree
 */
type TreeNode<H> = {
  value: string;
  left?: TreeNode<H>;
  right?: TreeNode<H>;
};

/**
 * HashRing implements consistent hashing for distributed systems.
 * It maps keys to nodes in a way that minimizes remapping when nodes are added or removed.
 *
 * Features:
 * - Virtual nodes (replicas) for better key distribution
 * - Automatic prevention of adjacent replicas
 * - Support for custom hash functions
 * - Configurable number of replicas per node
 * - Range queries and node distribution analysis
 *
 * @template T - The type of nodes stored in the hash ring
 * @template H - The type of hash values (default: string)
 *
 * @example
 * ```typescript
 * // Create a hash ring with string nodes
 * const ring = new HashRing<string>(['server1', 'server2', 'server3']);
 *
 * // Get the node responsible for a key
 * const node = ring.getNode('user:123'); // Returns 'server1', 'server2', or 'server3'
 *
 * // Add a new node
 * ring.addNode('server4');
 *
 * // Remove a node
 * ring.removeNode('server2');
 *
 * // Check distribution
 * const validation = ring.validateDistribution();
 * console.log(validation.isValid); // true if no adjacent replicas
 * ```
 */
export default class HashRing<T, H = string> {
  private root?: TreeNode<H>;
  private nodesMap = new Map<string, T>();
  private replicas: number;
  private hashFn: (key: string) => string;
  private sortFn?: (a: string, b: string) => number;
  private nodeToString: (node: T) => string;
  private virtualKeyMap = new Map<string, string>(); // Maps digest to original virtual key

  /**
   * Creates a new HashRing instance.
   *
   * @param nodes - Initial array of nodes to add to the ring
   * @param replicas - Number of virtual nodes per physical node (default: 50). More replicas provide better distribution
   * @param hashFn - Hash function to map keys to positions on the ring (default: SHA256)
   * @param spreadHashing - If true, uses spread hashing to reduce initial adjacent replicas (default: true)
   * @param sortFn - Optional custom sort function for hash values. Required when using numeric hashes
   * @param nodeToString - Optional function to convert nodes to string keys. Defaults to toString() or JSON.stringify()
   *
   * @example
   * ```typescript
   * // Basic usage
   * const ring = new HashRing(['node1', 'node2']);
   *
   * // With custom hash function
   * const ring = new HashRing(['node1', 'node2'], 100, murmurHash3);
   *
   * // With numeric hash and sort function
   * const ring = new HashRing(
   *   ['node1', 'node2'],
   *   50,
   *   numericHash,
   *   false,
   *   (a, b) => parseInt(a) - parseInt(b)
   * );
   * ```
   */
  constructor(
    nodes: T[] = [],
    replicas = 50,
    hashFn: (key: string) => string = (key) =>
      createHash('sha256').update(key).digest('hex'),
    spreadHashing = true,
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
    nodes.forEach((n) => this.addNode(n, spreadHashing));
  }

  /**
   * Adds a node to the hash ring.
   * Creates multiple virtual nodes (replicas) for better key distribution.
   * Validates and reorganizes to prevent adjacent replicas of the same node.
   *
   * @param node - The node to add to the ring
   * @param useSpreadHashing - If true, uses a spread hashing strategy to reduce adjacent replicas
   */
  public addNode(node: T, useSpreadHashing = false): void {
    const nodeStr = this.nodeToString(node);

    // First, add all replicas normally
    for (let i = 0; i < this.replicas; i++) {
      let virtualNodeKey: string;

      if (useSpreadHashing) {
        const spreadFactor =
          Math.floor(i / Math.max(1, this.getNodesCount())) + 1;
        virtualNodeKey = `${nodeStr}:${i}:spread${spreadFactor}`;
      } else {
        virtualNodeKey = `${nodeStr}:${i}`;
      }

      const digest = this.hashFn(virtualNodeKey);
      this.root = this.insertNode(this.root, digest);
      this.nodesMap.set(digest, node);
      this.virtualKeyMap.set(digest, virtualNodeKey);
    }

    // Fix any adjacent replicas
    this.fixAdjacentReplicas();
  }

  /**
   * Removes a node from the hash ring.
   * Removes all virtual nodes (replicas) associated with this node.
   * Automatically fixes any adjacent replicas that may be created by the removal.
   *
   * @param node - The node to remove from the ring
   *
   * @example
   * ```typescript
   * ring.removeNode('server2');
   * // All virtual nodes for 'server2' are removed
   * // Adjacent replicas are automatically fixed
   * ```
   */
  public removeNode(node: T): void {
    const nodeStr = this.nodeToString(node);
    // Remove all possible virtual node variations
    const digestsToRemove: string[] = [];

    // Collect all digests that belong to this node
    for (const [digest, n] of this.nodesMap.entries()) {
      if (this.nodeToString(n) === nodeStr) {
        digestsToRemove.push(digest);
      }
    }

    // Remove them from the tree and map
    for (const digest of digestsToRemove) {
      this.root = this.deleteNode(this.root, digest);
      this.nodesMap.delete(digest);
      this.virtualKeyMap.delete(digest);
    }

    // Fix any adjacent replicas that may have been created by removal
    this.fixAdjacentReplicas();
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
   *
   * @example
   * ```typescript
   * const ranges = ring.getRangesForNode('server1');
   * ranges.forEach(({ start, end }) => {
   *   if (start > end) {
   *     console.log(`Wrap-around range: ${start} -> ${end}`);
   *   }
   * });
   * ```
   */
  public getRangesForNode(node: T): { start: string; end: string }[] {
    const all = this.getSortedDigests();
    const nodeStr = this.nodeToString(node);
    const nodeDigests: string[] = [];

    // Find all digests that belong to this node by checking the nodesMap
    for (const [digest, n] of this.nodesMap.entries()) {
      if (this.nodeToString(n) === nodeStr) {
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
   *
   * @example
   * ```typescript
   * const owner = ring.getNodeForRange({ start: '1234', end: '5678' });
   * console.log(`Range owner: ${owner}`);
   * ```
   */
  public getNodeForRange(range: { start: string; end: string }): T | undefined {
    return this.nodesMap.get(range.end);
  }

  /**
   * Finds all nodes that have ownership of any part of the given range.
   * This handles wrap-around ranges where start > end.
   * Useful for finding which nodes would be affected by a range query.
   *
   * @param start - The starting hash value of the range
   * @param end - The ending hash value of the range
   * @returns Array of unique nodes that own parts of the specified range
   *
   * @example
   * ```typescript
   * // Find all nodes in a range
   * const nodes = ring.getNodesInRange('0000', 'ffff');
   * console.log(`${nodes.length} nodes own parts of this range`);
   *
   * // Handle wrap-around range
   * const wrapNodes = ring.getNodesInRange('f000', '1000');
   * ```
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
   *
   * @example
   * ```typescript
   * const ring = new HashRing(['A', 'B', 'C'], 10);
   * console.log(ring.getNodesCount()); // 3 (not 30)
   * ```
   */
  public getNodesCount(): number {
    return this.nodesMap.size / this.replicas;
  }

  /**
   * Gets the ordered positions of all nodes in the ring.
   * Returns information about each virtual node position, including which physical node it belongs to.
   * Useful for debugging and visualizing the ring structure.
   *
   * @returns Array of objects containing hash position, node, and virtual replica index
   * @returns {string} position - The hash digest position in the ring
   * @returns {T} node - The physical node at this position
   * @returns {number} replicaIndex - The replica index (0 to replicas-1)
   *
   * @example
   * ```typescript
   * const orderedNodes = ring.getOrderedNodes();
   * orderedNodes.forEach(({ position, node, replicaIndex }) => {
   *   console.log(`Position ${position}: ${node} (replica ${replicaIndex})`);
   * });
   * ```
   */
  public getOrderedNodes(): Array<{
    position: string;
    node: T;
    replicaIndex: number;
  }> {
    const sortedDigests = this.getSortedDigests();
    const result: Array<{
      position: string;
      node: T;
      replicaIndex: number;
    }> = [];

    for (const digest of sortedDigests) {
      const node = this.nodesMap.get(digest);
      if (node !== undefined) {
        // Get the original virtual key from our map
        const virtualKey = this.virtualKeyMap.get(digest) || '';
        let replicaIndex = -1;

        // Extract replica index from the virtual key
        const match = virtualKey.match(/:([0-9]+)(?::spread|$|_)/);
        if (match) {
          replicaIndex = parseInt(match[1]);
        }

        result.push({
          position: digest,
          node,
          replicaIndex,
        });
      }
    }

    return result;
  }

  /**
   * Gets a summary of how nodes are distributed in the ring.
   * Groups virtual nodes by their physical node.
   *
   * @returns Map of nodes to their positions (hash digests) in the ring
   *
   * @example
   * ```typescript
   * const distribution = ring.getNodeDistribution();
   * for (const [node, positions] of distribution) {
   *   console.log(`${node} has ${positions.length} replicas`);
   * }
   * ```
   */
  public getNodeDistribution(): Map<T, string[]> {
    const distribution = new Map<T, string[]>();
    const orderedNodes = this.getOrderedNodes();

    for (const { position, node } of orderedNodes) {
      if (!distribution.has(node)) {
        distribution.set(node, []);
      }
      distribution.get(node)!.push(position);
    }

    return distribution;
  }

  /**
   * Checks if there are any adjacent replicas of the same node in the ring.
   * Returns detailed information about any adjacent replicas found.
   *
   * @returns Array of adjacent replica pairs, empty if ring is well-distributed
   * @returns {T} node - The node that has adjacent replicas
   * @returns {[string, string]} positions - The hash positions of the adjacent replicas
   * @returns {[number, number]} indices - The indices in the ordered node list
   *
   * @example
   * ```typescript
   * const adjacentPairs = ring.findAdjacentReplicas();
   * if (adjacentPairs.length > 0) {
   *   console.log('Found adjacent replicas:', adjacentPairs);
   * }
   * ```
   */
  public findAdjacentReplicas(): Array<{
    node: T;
    positions: [string, string];
    indices: [number, number];
  }> {
    const orderedNodes = this.getOrderedNodes();
    const adjacentPairs: Array<{
      node: T;
      positions: [string, string];
      indices: [number, number];
    }> = [];

    if (orderedNodes.length < 2) return adjacentPairs;

    for (let i = 0; i < orderedNodes.length; i++) {
      const current = orderedNodes[i];
      const next = orderedNodes[(i + 1) % orderedNodes.length];

      // Check if same node (considering wrap-around)
      const currentStr = this.nodeToString(current.node);
      const nextStr = this.nodeToString(next.node);

      if (currentStr === nextStr) {
        adjacentPairs.push({
          node: current.node,
          positions: [current.position, next.position],
          indices: [i, (i + 1) % orderedNodes.length],
        });
      }
    }

    return adjacentPairs;
  }

  /**
   * Validates that the hash ring has good distribution properties.
   * Checks for adjacent replicas and distribution balance.
   *
   * @returns Object with validation results and any issues found
   * @returns {boolean} isValid - True if no issues found
   * @returns {number} adjacentReplicas - Number of adjacent replica pairs
   * @returns {Map<T, number>} distributionBalance - Map of nodes to their replica counts
   * @returns {string[]} issues - Array of validation issue descriptions
   *
   * @example
   * ```typescript
   * const validation = ring.validateDistribution();
   * if (!validation.isValid) {
   *   console.log('Issues found:', validation.issues);
   * }
   * ```
   */
  public validateDistribution(): {
    isValid: boolean;
    adjacentReplicas: number;
    distributionBalance: Map<T, number>;
    issues: string[];
  } {
    const adjacentPairs = this.findAdjacentReplicas();
    const distribution = this.getNodeDistribution();
    const issues: string[] = [];

    // Check for adjacent replicas
    if (adjacentPairs.length > 0) {
      issues.push(`Found ${adjacentPairs.length} adjacent replica pairs`);
      adjacentPairs.forEach(({ node, positions }) => {
        issues.push(
          `  - Node ${this.nodeToString(
            node
          )} has adjacent replicas at positions ${positions[0]} and ${
            positions[1]
          }`
        );
      });
    }

    // Check distribution balance
    const distributionBalance = new Map<T, number>();
    for (const [node, positions] of distribution.entries()) {
      distributionBalance.set(node, positions.length);
    }

    // Check if all nodes have the expected number of replicas
    const expectedReplicas = this.replicas;
    for (const [node, count] of distributionBalance.entries()) {
      if (count !== expectedReplicas) {
        issues.push(
          `Node ${this.nodeToString(
            node
          )} has ${count} replicas instead of ${expectedReplicas}`
        );
      }
    }

    return {
      isValid: issues.length === 0,
      adjacentReplicas: adjacentPairs.length,
      distributionBalance,
      issues,
    };
  }

  /**
   * Gets the count of unique nodes in the ring (not including replicas).
   *
   * @returns The number of unique nodes
   * @private
   */
  private getUniqueNodeCount(): number {
    const uniqueNodes = new Set<string>();
    for (const node of this.nodesMap.values()) {
      uniqueNodes.add(this.nodeToString(node));
    }
    return uniqueNodes.size;
  }

  /**
   * Checks if placing a node at a specific position would create an adjacency.
   * Used during node rotation to find valid positions.
   *
   * @param node - The node to check
   * @param position - The position (digest) where the node would be placed
   * @returns true if placing the node at this position would create an adjacency
   * @private
   */
  private checkIfPositionCreatesAdjacency(node: T, position: string): boolean {
    // Get all current positions sorted
    const positions: Array<{ digest: string; node: T }> = [];

    for (const [digest, n] of this.nodesMap.entries()) {
      positions.push({ digest, node: n });
    }

    // Add the proposed position
    positions.push({ digest: position, node });

    // Sort by digest
    positions.sort((a, b) => {
      const cmp = this.sortFn ?? ((x, y) => x.localeCompare(y));
      return cmp(a.digest, b.digest);
    });

    // Find where the new position is in the sorted array
    const newPosIndex = positions.findIndex((p) => p.digest === position);
    if (newPosIndex === -1) return false;

    const nodeStr = this.nodeToString(node);

    // Check previous neighbor
    const prevIndex = (newPosIndex - 1 + positions.length) % positions.length;
    const prevNodeStr = this.nodeToString(positions[prevIndex].node);
    if (prevNodeStr === nodeStr) return true;

    // Check next neighbor
    const nextIndex = (newPosIndex + 1) % positions.length;
    const nextNodeStr = this.nodeToString(positions[nextIndex].node);
    if (nextNodeStr === nodeStr) return true;

    return false;
  }

  /**
   * Fixes adjacent replicas by rotating nodes to different positions.
   * This method is called automatically after adding or removing nodes to ensure
   * no two adjacent positions belong to the same physical node.
   *
   * The algorithm:
   * 1. Finds all adjacent replica pairs
   * 2. For each pair, attempts to relocate one replica to a non-adjacent position
   * 3. Uses rotation suffixes to change the hash value while preserving node identity
   * 4. Continues until no adjacent replicas remain or no valid positions are found
   *
   * @private
   */
  private fixAdjacentReplicas(): void {
    // If we have less than 2 unique nodes, no adjacency issues possible
    if (this.getUniqueNodeCount() < 2) {
      return;
    }

    // Check for adjacent replicas and fix them
    let adjacentPairs = this.findAdjacentReplicas();

    // Rotate nodes to fix adjacency issues
    while (adjacentPairs.length > 0) {
      // Get the first adjacent pair
      const pair = adjacentPairs[0];
      const orderedNodes = this.getOrderedNodes();

      // Find the indices of the adjacent nodes
      const firstIndex = pair.indices[0];
      const secondIndex = pair.indices[1];

      // Find a non-adjacent position to rotate to
      let targetIndex = -1;

      // Try to find a position where the second node won't be adjacent to the same node
      for (let i = 0; i < orderedNodes.length; i++) {
        if (i === firstIndex || i === secondIndex) continue;

        const prevIndex = (i - 1 + orderedNodes.length) % orderedNodes.length;
        const nextIndex = (i + 1) % orderedNodes.length;

        const prevNode = orderedNodes[prevIndex].node;
        const nextNode = orderedNodes[nextIndex].node;
        const currentNode = orderedNodes[secondIndex].node;

        const prevNodeStr = this.nodeToString(prevNode);
        const nextNodeStr = this.nodeToString(nextNode);
        const currentNodeStr = this.nodeToString(currentNode);

        // Check if placing the node here would create adjacency
        if (prevNodeStr !== currentNodeStr && nextNodeStr !== currentNodeStr) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex !== -1) {
        // Remove the second node from its current position and reinsert with modified virtual key
        const secondNode = orderedNodes[secondIndex];
        const oldDigest = secondNode.position;
        const oldVirtualKey = this.virtualKeyMap.get(oldDigest) || '';

        // Remove from tree and maps
        this.root = this.deleteNode(this.root, oldDigest);
        this.nodesMap.delete(oldDigest);
        this.virtualKeyMap.delete(oldDigest);

        // Create a new virtual key with a rotation suffix to change its hash
        let rotationAttempt = 1;
        let newDigest: string;
        let newVirtualKey: string;

        do {
          newVirtualKey = `${oldVirtualKey}_rotate${rotationAttempt}`;
          newDigest = this.hashFn(newVirtualKey);
          rotationAttempt++;
        } while (
          this.nodesMap.has(newDigest) ||
          this.checkIfPositionCreatesAdjacency(secondNode.node, newDigest)
        );

        // Re-add with new digest
        this.root = this.insertNode(this.root, newDigest);
        this.nodesMap.set(newDigest, secondNode.node);
        this.virtualKeyMap.set(newDigest, newVirtualKey);
      } else {
        // If we can't find a good position, break to avoid infinite loop
        break;
      }

      // Check for adjacent replicas again
      adjacentPairs = this.findAdjacentReplicas();
    }
  }

  /**
   * Performs in-order traversal to collect all hash digests in sorted order.
   *
   * @returns Array of hash values in ascending order
   * @private
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
   * @private
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
   * @private
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
   * Used for BST deletion when finding in-order successor.
   *
   * @param node - Root of the subtree
   * @returns The node with the minimum value
   * @private
   */
  private minNode(node: TreeNode<H>): TreeNode<H> {
    return node.left ? this.minNode(node.left) : node;
  }

  /**
   * Finds the first node with value greater than or equal to target.
   * Used to find the node responsible for a key in the ring.
   * Implements the core consistent hashing lookup algorithm.
   *
   * @param node - Current tree node
   * @param target - Target hash value to find successor for
   * @param successor - Current best successor found
   * @returns The successor node or undefined if none found
   * @private
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
