import HashRing from './hash-ring';

export default class Node {
  public name: string;
  public ranges: string[] = [];
  constructor(name: string) {
    this.ranges = [];
    this.name = name;
  }

  public addRange(range: string) {
    this.ranges.push(range);
  }
}

// 1) Crear un anillo con nodos iniciales y 100 réplicas
const ring = new HashRing<Node>(
  [new Node('A'), new Node('B'), new Node('C')],
  1
);

// 2) Consultar cuántos nodos físicos hay
console.log(ring.getNodesCount());
// → 3

// 3) Mapear múltiples claves a nodos
const keys = ['1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-1234'];
console.log('Asignaciones iniciales:');
keys.forEach((key) => {
  console.log(
    `La clave ${key} está asignada al nodo ${ring.getNode(key)?.name}`
  );
});

// 4) Añadir un nuevo nodo D
// ring.addNode('D');
// console.log(`\nNodos físicos tras añadir D: ${ring.getNodesCount()}`);

// 4) Añadir un nuevo nodo D
// ring.addNode('D');
// console.log(`\nNodos físicos tras añadir D: ${ring.getNodesCount()}`);
// console.log('Asignaciones tras añadir D:');
// keys.forEach(key => {
//   console.log(`La clave ${key} está asignada al nodo ${ring.getNode(key)}`);
// });

// 5) Eliminar un nodo B
// ring.removeNode('B');
// console.log(`\nNodos físicos tras eliminar B: ${ring.getNodesCount()}`);
// console.log('Asignaciones tras eliminar B:');
// keys.forEach(key => {
//   console.log(`La clave ${key} está asignada al nodo ${ring.getNode(key)}`);
// });
