# HashRing

**Hash Ring** (Consistent Hashing) library in TypeScript for uniformly distributing keys across nodes.

---

## 📦 Installation

```bash
# Using npm
npm install generic_hash_ring

# Using yarn
yarn add generic_hash_ring
```

---

## 🚀 Basic Usage

```ts
import { HashRing } from 'hashring';

interface Server {
  id: string;
  host: string;
}

// Create node instances
const nodes: Server[] = [
  { id: 'node1', host: '10.0.0.1' },
  { id: 'node2', host: '10.0.0.2' },
  { id: 'node3', host: '10.0.0.3' },
];

// Initialize the ring with 100 replicas per node
const ring = new HashRing<Server>(nodes, 100);

// Get the node responsible for a key
const key = 'user:1234';
const server = ring.getNode(key);

console.log(`Key "${key}" maps to:`, server);
```

---

## 🛠️ API

### Constructor

```ts
new HashRing<T>(
  nodes?: T[],
  replicas?: number,
  hashFn?: (key: string) => string
)
```

- `nodes` (T[]) — Initial list of nodes.
- `replicas` (number) — Virtual replicas per node (default 100).
- `hashFn` (key: string) => string — Hash function (default SHA-256 in hex).

---

### Methods

#### addNode(node: T): void

Adds a node (and its replicas) to the ring.

#### removeNode(node: T): void

Removes a node (and all its replicas) from the ring.

#### getNode(key: string): T | undefined

Given a key, returns the corresponding node. Returns `undefined` if the ring is empty.

#### getNodesCount(): number

Number of **physical nodes** in the ring.

---

## ⚙️ Available Scripts

In `package.json`:

- `npm run build` — Compiles TypeScript to JavaScript in `./dist`.
- `npm run dev` — Runs `src/index.ts` with `ts-node`.
- `npm start` — Runs `dist/index.js` with Node.js.

---

## 📖 Complete Example

```ts
import { HashRing } from 'hashring';

type Node = string;

// Initialize with two nodes and 50 replicas
const ring = new HashRing<Node>(['A', 'B'], 50);

// Assign several keys
const keys = ['alpha', 'beta', 'gamma', 'delta'];

keys.forEach((k) => {
  console.log(`Key="${k}" -> Node="${ring.getNode(k)}"`);
});

// Add a new node
ring.addNode('C');
console.log('\nAfter adding C:');
keys.forEach((k) => {
  console.log(`Key="${k}" -> Node="${ring.getNode(k)}"`);
});
```

---

## 📄 License

This project is distributed under the **Apache License 2.0**.  
See the [`LICENSE`](./LICENSE) file for more details.
