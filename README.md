# HashRing

Librería de **Hash Ring** (Consistent Hashing) en TypeScript para distribuir llaves de forma uniforme entre nodos.

---

## 📦 Instalación

```bash
# Usando npm
npm install generic_hash_ring

# Usando yarn
yarn add generic_hash_ring
```

---

## 🚀 Uso básico

```ts
import { HashRing } from 'hashring';

interface Server {
  id: string;
  host: string;
}

// Creamos instancias de nodos
const nodes: Server[] = [
  { id: 'node1', host: '10.0.0.1' },
  { id: 'node2', host: '10.0.0.2' },
  { id: 'node3', host: '10.0.0.3' },
];

// Inicializamos el anillo con 100 réplicas por nodo
const ring = new HashRing<Server>(nodes, 100);

// Obtenemos el nodo responsable de una llave
const key = 'user:1234';
const server = ring.getNode(key);

console.log(`La llave "${key}" corresponde a:`, server);
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

- `nodes` (T[]) — Lista inicial de nodos.
- `replicas` (number) — Réplicas virtuales por nodo (por defecto 100).
- `hashFn` (key: string) => string — Función de hash (por defecto SHA-256 en hexadecimal).

---

### Métodos

#### addNode(node: T): void

Agrega un nodo (y sus réplicas) al anillo.

#### removeNode(node: T): void

Elimina un nodo (y todas sus réplicas) del anillo.

#### getNode(key: string): T \| undefined

Dada una llave, retorna el nodo correspondiente. Devuelve `undefined` si el anillo está vacío.

#### getNodesCount(): number

Número de **nodos físicos** en el anillo.

---

## ⚙️ Scripts disponibles

En el `package.json`:

- `npm run build` — Compila TypeScript a JavaScript en `./dist`.
- `npm run dev` — Ejecuta `src/index.ts` con `ts-node`.
- `npm start` — Ejecuta `dist/index.js` con Node.js.

---

## 📖 Ejemplo completo

```ts
import { HashRing } from 'hashring';

type Node = string;

// Inicializamos con dos nodos y 50 réplicas
const ring = new HashRing<Node>(['A', 'B'], 50);

// Asignamos varias llaves
const keys = ['alpha', 'beta', 'gamma', 'delta'];

keys.forEach((k) => {
  console.log(`Key="${k}" -> Node="${ring.getNode(k)}"`);
});

// Agregamos un nuevo nodo
ring.addNode('C');
console.log('\nDespués de agregar C:');
keys.forEach((k) => {
  console.log(`Key="${k}" -> Node="${ring.getNode(k)}"`);
});
```

---

## 📄 Licencia

Este proyecto se distribuye bajo la **Apache License 2.0**.  
Consulta el archivo [`LICENSE`](./LICENSE) para más detalles.
