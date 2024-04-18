import { IdPool } from "IdPool";
import { SparseSet } from "SparseSet";
import { InstanceTypeTuple, Constructor, join } from "./util";

/**
 * An opaque identifier used to access component arrays
 */
export type Entity = number;

/**
 * The Null entity can be used to initialize a variable
 * which is meant to hold an entity without actually using `null`.
 */
export const Null: Entity = -1;

/**
 * Stores arbitrary data
 */
export interface Component {
  free?: () => void;
  [x: string]: any;
  [x: number]: any;
}

// Type aliases for component storage
interface TypeStorage<T> {
  [type: string]: T;
}
interface ComponentStorage<T> {
  components: T[];
  sparseSet: SparseSet;
}

// TODO: store entities in Array<Entity> instead of Set<Entity>
// if an entity is destroyed, set it in the array to -1
// skip entities marked as -1 in views

/**
 * World is the core of the ECS.
 * It stores all entities and their components, and enables efficiently querying them.
 *
 * Visit https://jprochazk.github.io/uecs/ for a comprehensive tutorial.
 */
export class World {
  private ids = new IdPool();
  private entities = new SparseSet(2048);
  private componentsStorage: TypeStorage<ComponentStorage<Component>> = {};
  private views: { [id: string]: View<any> } = {};

  /**
   * Creates an entity, and optionally assigns all `components` to it.
   */
  create<T extends Component[]>(...components: T): Entity {
    const entity = this.ids.reserve();
    this.entities.add(entity);

    // emplace all components into entity
    for (let i = 0, len = components.length; i < len; ++i) {
      this.emplace(entity, components[i]);
    }

    return entity;
  }

  /**
   * Returns true if `entity` exists in this World
   */
  exists(entity: Entity): boolean {
    return this.entities.has(entity);
  }

  /**
   * Destroys an entity and all its components
   *
   * Calls `.free()` (if available) on each destroyed component
   *
   * Example:
   * ```
   *  class A { free() { console.log("A freed"); } }
   *  const world = new World();
   *  const entity = world.create(new A);
   *  world.destroy(entity); // logs "A freed"
   * ```
   */
  destroy(entity: Entity) {
    this.entities.remove(entity);
    this.ids.release(entity);
    for (const key in this.componentsStorage) {
      const storage = this.componentsStorage[key];
      const sparseSet = storage.sparseSet;
      if (sparseSet.has(entity)) {
        const index = sparseSet.get(entity);
        const component = storage.components[index];
        if (component !== undefined && component.free !== undefined)
          component.free();
        sparseSet.remove(entity);
      }
    }
  }

  /**
   * Retrieves `component` belonging to `entity`. Returns `undefined`
   * if it the entity doesn't have `component`, or the `entity` doesn't exist.
   *
   * Example:
   * ```
   *  class A { value = 50 }
   *  class B {}
   *  const world = new World();
   *  const entity = world.create();
   *  world.emplace(entity, new A);
   *  world.get(entity, A).value; // 50
   *  world.get(entity, A).value = 10;
   *  world.get(entity, A).value; // 10
   *  world.get(entity, B); // undefined
   *  world.get(100, A); // undefined
   * ```
   */
  get<T extends Component>(
    entity: Entity,
    component: Constructor<T>
  ): T | undefined {
    const type = component.name;
    const storage = this.componentsStorage[type];
    if (storage === undefined) return undefined;
    const sparseSet = storage.sparseSet;
    if (!sparseSet.has(entity)) return undefined;
    const index = sparseSet.get(entity);
    return storage.components[index] as T | undefined;
  }

  /**
   * Returns `true` if `entity` exists AND has `component`, false otherwise.
   *
   * Example:
   * ```
   *  class A {}
   *  const world = new World();
   *  const entity = world.create();
   *  world.has(entity, A); // false
   *  world.emplace(entity, new A);
   *  world.has(entity, A); // true
   *  world.has(100, A); // false
   * ```
   */
  has<T extends Component>(entity: Entity, component: Constructor<T>): boolean {
    const type = component.name;
    const storage = this.componentsStorage[type];
    return storage !== undefined && storage.sparseSet.has(entity);
  }

  /**
   * Sets `entity`'s instance of component `type` to `component`.
   * @throws If `entity` does not exist
   *
   *
   * Warning: Overwrites any existing instance of the component.
   * This is to avoid an unnecessary check in 99% of cases where the
   * entity does not have the component yet. Use `world.has` to
   * check for the existence of the component first, if this is undesirable.
   *
   * Example:
   * ```
   *  class A { constructor(value) { this.value = value } }
   *  const entity = world.create();
   *  world.emplace(entity, new A(0));
   *  world.emplace(entity, new A(5));
   *  world.get(entity, A); // A { value: 5 } -> overwritten
   * ```
   *
   * Note: This is the only place in the API where an error will be
   * thrown in case you try to use a non-existent entity.
   *
   * Here's an example of why it'd be awful if `World.emplace` *didn't* throw:
   * ```ts
   *  class A { constructor(value = 0) { this.value = value } }
   *  const world = new World;
   *  world.exists(0); // false
   *  world.emplace(0, new A);
   *  // entity '0' doesn't exist, but it now has a component.
   *  // let's try creating a brand new entity:
   *  const entity = world.create();
   *  // *BOOM!*
   *  world.get(0, A); // A { value: 0 }
   *  // it'd be extremely difficult to track down this bug.
   * ```
   */
  emplace<T extends Component>(entity: Entity, component: T) {
    const type = component.name ?? component.constructor.name;

    if (!this.entities.has(entity)) {
      throw new Error(
        `Cannot set component "${type}" for dead entity ID ${entity}`
      );
    }

    let storage = this.componentsStorage[type];
    if (storage === undefined)
      storage = {
        components: [],
        sparseSet: new SparseSet(2048),
      };
    this.componentsStorage[type] = storage;
    const index = storage.sparseSet.add(entity);
    storage.components[index] = component;
  }

  /**
   * Removes instance of `component` from `entity`, and returns the removed component.
   * Returns `undefined` if nothing was removed, or if `entity` does not exist.
   *
   * Example:
   * ```
   *  class A { value = 10 }
   *  const world = new World();
   *  const entity = world.create();
   *  world.emplace(entity, new A);
   *  world.get(entity, A).value = 50
   *  world.remove(entity, A); // A { value: 50 }
   *  world.remove(entity, A); // undefined
   * ```
   *
   * This does **not** call `.free()` on the component. The reason for this is that
   * you don't always want to free the removed component. Don't fret, you can still
   * free component, because the `World.remove` call returns it! Example:
   * ```
   *  class F { free() { console.log("freed") } }
   *  const world = new World;
   *  const entity = world.create(new F);
   *  world.remove(entity, F).free();
   *  // you can use optional chaining to easily guard against the 'undefined' case:
   *  world.remove(entity, F)?.free();
   * ```
   */
  remove<T extends Component>(
    entity: Entity,
    component: Constructor<T>
  ): T | undefined {
    const type = component.name;
    const storage = this.componentsStorage[type];
    if (storage === undefined) return undefined;
    const sparseSet = storage.sparseSet;
    if (!sparseSet.has(entity)) return undefined;
    const index = sparseSet.get(entity);
    const out = storage.components[index] as T | undefined;
    const lastIndex = sparseSet.getSize() - 1;
    storage.components[index] = storage.components[lastIndex];
    storage.components.pop();
    sparseSet.remove(entity);
    return out;
  }

  /**
   * Returns the size of the world (how many entities are stored)
   */
  size(): number {
    return this.entities.getSize();
  }

  /**
   * Used to query for entities with specific component combinations
   * and efficiently iterate over the result.
   *
   * Example:
   * ```
   *  class Fizz { }
   *  class Buzz { }
   *  const world = new World();
   *  for (let i = 0; i < 100; ++i) {
   *      const entity = world.create();
   *      if (i % 3 === 0) world.emplace(entity, new Fizz);
   *      if (i % 5 === 0) world.emplace(entity, new Buzz);
   *  }
   *
   *  world.view(Fizz, Buzz).each((n) => {
   *      console.log(`FizzBuzz! (${n})`);
   *  });
   * ```
   */
  view<T extends Constructor<Component>[]>(...types: T): View<T> {
    let id = "";
    for (let i = 0; i < types.length; ++i) {
      id += types[i].name;
    }
    if (!(id in this.views)) {
      // ensure that never-before seen types are registered.
      for (let i = 0; i < types.length; ++i) {
        if (this.componentsStorage[types[i].name] === undefined) {
          this.componentsStorage[types[i].name] = {
            components: [],
            sparseSet: new SparseSet(2048),
          };
        }
      }
      this.views[id] = new ViewImpl(this, types);
    }
    return this.views[id];
  }

  /**
   * Removes every entity, and destroys all components.
   */
  clear() {
    while (this.entities.getSize() > 0) {
      this.destroy(this.entities.getValues()[0]);
    }
  }

  /**
   * Returns an iterator over all the entities in the world.
   */
  all(): Iterable<Entity> {
    return this.entities;
  }
}

/**
 * The callback passed into a `View`, generated by a world.
 *
 * If this callback returns `false`, the iteration will halt.
 */
export type ViewCallback<T extends Constructor<Component>[]> = (
  entity: Entity,
  ...components: InstanceTypeTuple<T>
) => false | void;

/**
 * A view is a non-owning entity iterator.
 *
 * It is used to efficiently iterate over large batches of entities,
 * and their components.
 *
 * A view is lazy, which means that it fetches entities and components
 * just before they're passed into the callback.
 *
 * The callback may return false, in which case the iteration will halt early.
 *
 * This means you should avoid adding entities into the world, which have the same components
 * as the ones you're currently iterating over, unless you add a base case to your callback:
 * ```ts
 *  world.view(A, B, C).each((entity, a, b, c) => {
 *      // our arbitrary base case is reaching entity #1000
 *      // without this, the iteration would turn into an infinite loop.
 *      if (entity === 1000) return false;
 *      world.create(A, B, C);
 *  })
 * ```
 */
export interface View<T extends Constructor<Component>[]> {
  /**
   * Iterates over all the entities in the `View`.
   *
   * If you return `false` from the callback, the iteration will halt.
   */
  each(callback: ViewCallback<T>): void;
}

type ComponentView<T extends Constructor<Component>[]> = (
  callback: ViewCallback<T>
) => void;
class ViewImpl<T extends Constructor<Component>[]> {
  private view: ComponentView<T>;
  constructor(world: World, types: T) {
    this.view = generateView(world, types);
  }
  each(callback: ViewCallback<T>) {
    this.view(callback);
  }
}

const keywords = {
  world: "_$WORLD",
  entity: "_$ENTITY",
  callback: "_$CALLBACK",
  storage: "_$STORAGE",
};
function generateView(world: World, types: any[]): ComponentView<any> {
  const length = types.length;
  let storages = "";
  const storageNames = [];
  for (let i = 0; i < length; ++i) {
    const typeName = types[i].name;
    const name = `${keywords.storage}${typeName}`;
    storages += `const ${name} = ${keywords.world}.componentsStorage["${typeName}"];\n`;
    storageNames.push(name);
  }

  let condition = "";
  condition += "if (";
  for (let i = 0; i < length; ++i) {
    condition += `!${storageNames[i]}.sparseSet.has(${keywords.entity})`;
    if (i !== length - 1) condition += ` || `;
  }
  condition += ") continue;\n";

  let variables = "";
  variables += `let index = 0;\n`;
  const variableNames = [];
  for (let i = 0; i < length; ++i) {
    const typeName = types[i].name;
    const name = `${typeName}${i}`;
    variables += `index = ${storageNames[i]}.sparseSet.get(${keywords.entity});\n`;
    variables += `const ${name} = ${storageNames[i]}.components[index];\n`;
    variableNames.push(name);
  }

  const fn =
    "" +
    storages +
    `return function(${keywords.callback}) {\n` +
    `for (const ${keywords.entity} of ${keywords.world}.entities) {\n` +
    condition +
    variables +
    `if (${keywords.callback}(${keywords.entity},${join(
      variableNames,
      ","
    )}) === false) return;\n` +
    "}\n" +
    "}";

  return new Function(keywords.world, fn)(world) as any;
}
