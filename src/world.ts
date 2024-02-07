/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/cognitive-complexity */

import { getInTrie, setInTrie, type Trie, TrieSubsequenceIterator } from "./trie";
import { type Constructor, type InstanceTypeTuple, join } from "./util";

/**
 * An opaque identifier used to access component arrays
 */
export type Entity = number;

/**
 * The Null entity can be used to initialiaze a variable
 * which is meant to hold an entity without actually using `null`.
 */
export const Null: Entity = -1;

/** Type alias for registering a component as a Singleton. */
export type Singleton = Component;

/**
 * Stores arbitrary data
 */
export interface Component {
  /**
   * Called when the component is attached to an entity.
   * @param entity The entity the component was attached to.
   */
  added?: (entity: Entity) => void;
  /**
   * Callback called when a component is detached from an entity.
   * Usually will be followed by a call to `free`
   * @param entity The entity the component was detached from.
   */
  removed?: (entity: Entity) => void;
  interpolationSynced?: (rawData: any, syncTime: number) => void;
  /**
   * Callback called when a component is destroyed.
   * @param world The world the component was destroyed in.
   * @param entity The entity the component was attached to before it was destroyed.
   */
  free?: (world: World, entity: Entity) => void;
  // Note: These are here to avoid requiring a typecast when assigning to a weak type
  // (a type with all properties optional) in, e.g., World.create(new A()).
  [x: string]: any;
  [x: number]: any;
}

// Type aliases for component storage
interface TypeStorage<T> {
  [type: string]: T;
}
interface ComponentStorage<T> {
  [entity: number]: T;
}

/** Type of component type names: `Constructor.prototype.name`. */
type ComponentTypeName = string;
/** Type of component property names on an index iterator. */
export type IndexComponentName = string;
/** Named component tuples in an index spec. */
type IndexComponentSpec = [IndexComponentName, ComponentTypeName];

/** Specifies an index. Property names beginning with an underscore denote components that
 * must be present on the entity, but are not accessible from the iteration.
 *
 * Example: Given `class A {}; class B{};`, the index spec `{ a: A, b: B, _c: C }`
 * in the expression `world.index({ a: A, b: B, _c: C })`
 * specifies an index of types `A`, `B`, and `C`, which will be accessed by properties
 * `a` and `b`, with type `C` not being accessible, in the returned `IndexIterator.` */
export type IndexSpec = Record<IndexComponentName, Constructor<Component>>;

/** Removes all properties with a name starting with an underscore. */
type WithoutIgnoredComponents<IS extends IndexSpec> = Pick<
  IS,
  { [k in keyof IS]: k extends `_${string}` ? never : k }[keyof IS]
>;

/** Converts a Record of Constructors to a Record of the constructed types. */
type ConstructorsToTypes<IS extends IndexSpec> = {
  [key in keyof IS]: IS[key] extends Constructor<infer C> ? C : never;
};

/** Converts an `IndexSpec` to a record with properties of the specified component type. */
export type IndexRecord<IS extends IndexSpec> = ConstructorsToTypes<WithoutIgnoredComponents<IS>>;

/** Selects between an IndexIteratorBase with or without an entity property. */
type IndexIteratorBaseEntitySelector<IS extends IndexSpec, WithEntity extends boolean> = {
  entity: IndexIteratorBase<IS, WithEntity>;
  _entity: Omit<IndexIteratorBase<IS, WithEntity>, "entity">;
}[WithEntity extends true ? "entity" : "_entity"];

/** Symbol property name for `IndexIterator`'s current storage location. */
const $iS = Symbol.for("$iS");
/** Symbol property name for `IndexIterator`'s current additions version. */
const $addVer = Symbol.for("$addVer");
/** Symbol property name for `IndexIterator`'s current removals version. */
const $remVer = Symbol.for("$remVer");

/** Base for `IndexIterator`, which enables iterating an index.
 * This is reusable; call `start()` to reset it rather than creating a new one every time. */
class IndexIteratorBase<IS extends IndexSpec, WithEntity extends boolean> {
  /** The current position in the `Index`. Don't rely on this being meaningful. */
  private [$iS]: number;
  /** The current additions version number, synched with the index to determine whether it gained any elements. */
  private [$addVer]: number;
  /** The current removals version number, synched with the index to determine whether it lost any elements. */
  private [$remVer]: number;

  constructor(public indexBase: IndexBase<IS>, public names: (keyof IS)[]) {
    // Start one record back in storage so the first next() increments to 0.
    const nC = this.names.length;
    this[$iS] = -1 - nC;
    this[$addVer] = indexBase.observeAddVer();
    this[$remVer] = indexBase.observeRemVer();
  }

  /** Starts / resets the iterator. */
  start(): IndexIterator<IS, WithEntity> {
    // Start one record back in storage so the first next() increments to 0.
    const nC = this.names.length;
    this[$iS] = -1 - nC;
    // Undefine all properties.
    const { names } = this;
    this.entity = NaN;
    for (let iC = 0; iC < nC; ++iC) {
      (this as any)[names[iC]] = undefined;
    }
    return this as IndexIterator<IS, WithEntity>;
  }

  /** Moves to the next (entity, ...components) in the index.
   * This is also a type guard that informs TypeScript the component properties are valid.
   * @returns self, or undefined if at end */
  next(): this is IndexIteratorAtNext<IS, WithEntity> {
    const {
      indexBase: { storage },
      names,
    } = this;
    const nS = storage.length;
    const nC = names.length;
    // Find the next non-deleted entity.
    let iS = this[$iS];
    let entity: Entity | undefined;
    do {
      iS += 1 + nC;
      if (iS >= nS) {
        this[$iS] = iS;
        // Undefine all properties.
        this.entity = NaN;
        for (let iC = 0; iC < nC; ++iC) {
          (this as any)[names[iC]] = undefined;
        }
        return false;
      }
      entity = storage[iS] as Entity;
    } while (entity === undefined);
    // Continue from here next time.
    this[$iS] = iS;
    // Unpack entity and components.
    this.entity = entity;
    for (let iC = 0; iC < nC; ++iC) {
      // Set named properties on iterator to components.
      (this as any)[names[iC]] = storage[iS + iC + 1];
    }
    return true;
  }

  /** `it.first()?.` is quivalent to `if (it.start().next()) it.`.
   * Use to express intent when only one result is needed / expected. */
  first(): undefined | IndexIteratorAtNext<IS, WithEntity> {
    return this.start().next() ? (this as IndexIteratorAtNext<IS, WithEntity>) : undefined;
  }

  /** Equivalent to `.wasAddedTo() || .wasRemovedFrom()` */
  wasChanged(): boolean {
    return this.wasAddedTo() || this.wasRemovedFrom();
  }

  /** @returns `true` if index gained any items since last called (`false` on first call).
   * Doesn't track the exact set of items, so if all gained items were lost again, would still return `true`. */
  wasAddedTo(): boolean {
    const addVer = this.indexBase.observeAddVer();
    if (this[$addVer] != addVer) {
      this[$addVer] = addVer;
      return true;
    }
    return false;
  }

  /** @returns `true` if index lost any items since last called (`false` on first call).
   * Doesn't track the exact set of items, so if all lost items were gained back, would still return `true`. */
  wasRemovedFrom(): boolean {
    const remVer = this.indexBase.observeRemVer();
    if (this[$remVer] != remVer) {
      this[$remVer] = remVer;
      return true;
    }
    return false;
  }

  /** Entity at the current iteration. */
  entity: Entity = NaN;
}

/** Enables iterating an index.
 *
 * Usage: `for (it.start(); it.next(); ) { ...it.entity, it.indexSpecComponentName... }`
 *
 * This is reusable; call `start()` to reset it rather than creating a new one every time.
 *
 * Note that the base type of an iterator, `IndexIterator` has no component properties,
 * and `.next()` is a type guard that informs TypeScript they exist via `IndexIteratorAtEntity`.
 */
export type IndexIterator<IS extends IndexSpec, WithEntity extends boolean> = IndexIteratorBaseEntitySelector<
  IS,
  WithEntity
>;

/** Enables iterating an index.
 *
 * Usage: `for (it.start(); it.next(); ) { ...it.entity, it.indexSpecComponentName... }`
 *
 * Note that the base type of an iterator, `IndexIterator` has no component properties,
 * and `.next()` is a type guard that informs TypeScript they exist via `IndexIteratorAtEntity`.
 */
export type IndexIteratorAtNext<IS extends IndexSpec, WithEntity extends boolean> = IndexIteratorBaseEntitySelector<
  IS,
  WithEntity
> &
  IndexRecord<IS>;

/** Enables faster iteration of entities that have a specific set of components. */
export class IndexBase<C extends Component> {
  /** Map from entity to its (entity, ...components) index in storage. Always a multiple of types.length. */
  entityISByEntity = new Map<Entity, number>();
  /** Linearized storage for (entity, ...components). */
  storage: (undefined | Entity | C)[] = [];
  /** List of free indexes in elements. */
  freeISs: number[] = [];

  /** Increments when one or more entities have been added. */
  addVer = 0;
  /** Indicates whether an addVer has been observed. */
  addVerObserved = true;
  /** Increments when one or more entities have been removed. */
  remVer = 0;
  /** Indicates whether a remVer has been observed. */
  remVerObserved = true;

  constructor(public types: ComponentTypeName[]) {}

  /** Adds entity and components (sorted by component type names), to the index.
   * @param components sorted by component type names; only the number of components in the index will be used */
  add(entity: Entity, components: C[]) {
    // If there are any free indexes in the index, store there; otherwise store at the end.
    const { storage, entityISByEntity } = this;
    const iS = entityISByEntity.get(entity) ?? this.freeISs.pop() ?? storage.length;
    // Track where in the index the entity is stored for fast deletion.
    this.entityISByEntity.set(entity, iS);
    // Store entity and components sequentially in the index.
    const nC = this.types.length;
    storage[iS] = entity;
    for (let iC = 0; iC < nC; ++iC) {
      storage[iS + iC + 1] = components[iC];
    }
    // Update add version.
    if (this.addVerObserved) {
      this.addVer++;
      this.addVerObserved = false;
    }
  }

  /** If the entity is already in the index, updates the component of the specified type.
   * @returns `false` if `entity` is not in the index, `true` otherwise.
   * @throws if the type is not in the index's component type set. */
  emplace(entity: Entity, type: ComponentTypeName, component: C): boolean {
    const iS = this.entityISByEntity.get(entity);
    if (iS === undefined) {
      return false;
    }
    // Linear search for the component type.
    const types = this.types;
    const nC = types.length;
    for (let iC = 0; iC < nC; ++iC) {
      if (types[iC] == type) {
        this.storage[iS + iC + 1] = component;
        return true;
      }
    }
    throw new Error(`Type ${type} is not in the index <${types.join(",")}>`);
  }

  /** Removes an entity from the index.
   * @returns `true` if `entity` was in the index and was deleted, `false` otherwise. */
  remove(entity: Entity): boolean {
    // If entity not in the index, do nothing.
    const { storage, entityISByEntity } = this;
    const iS = entityISByEntity.get(entity);
    if (iS === undefined) {
      return false;
    }
    // Remove entity from map.
    entityISByEntity.delete(entity);
    // Add index to free list.
    this.freeISs.push(iS);
    // Overwrite entity and components with undefined; iterator next will skip these.
    // TODO-ECS-PERF: Maybe move an entry from the end in to fill. But how would that work with in-progress iterators?
    const nC = this.types.length;
    storage[iS] = undefined;
    for (let iC = 0; iC < nC; ++iC) {
      storage[iS + iC + 1] = undefined;
    }
    if (this.remVerObserved) {
      this.remVer++;
      this.remVerObserved = false;
    }
    return true;
  }

  observeAddVer(): number {
    this.addVerObserved = true;
    return this.addVer;
  }

  observeRemVer(): number {
    this.remVerObserved = true;
    return this.remVer;
  }
}

type EntityTracker = { entityAdded?: (entity: Entity) => void; entityRemoved?: (entity: Entity) => void };

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
  private entitySequence: Entity = 0;
  private entities: Set<Entity> = new Set();
  private components: TypeStorage<ComponentStorage<Component>> = {};
  private views: { [id: string]: View<any> } = {};
  private readonly singletonEntity = -2;
  private entityTracker?: EntityTracker;

  /** Map from component type to all indexes using it, for updating indexes on component deletions. */
  private indexesByComponent = new Map<string, IndexBase<Component>[]>();
  /** Trie of (sorted) component type set to index. */
  private indexByComponents: Trie<ComponentTypeName, IndexBase<Component>> = {};
  /** Iterator for searching for indexes on a subset of a given type set. */
  private indexByComponentsSubIt = new TrieSubsequenceIterator([], this.indexByComponents);

  trackEntities(entityTracker: EntityTracker) {
    this.entityTracker = entityTracker;
  }

  registerSingleton<T extends Singleton>(component: T) {
    if (!this.entities.has(this.singletonEntity)) {
      this.entities.add(this.singletonEntity);
    }

    this.emplace(this.singletonEntity, component);
  }

  getSingleton<T extends Singleton>(type: Constructor<T>): T | undefined {
    return this.get(this.singletonEntity, type);
  }

  removeSingleton<T extends Singleton>(type: Constructor<T>): void {
    if (!this.entities.has(this.singletonEntity)) {
      return;
    }

    this.remove(this.singletonEntity, type);
  }

  private create_typesP: ComponentTypeName[] = [];
  private create_ecs: Component[] = [];

  /**
   * Creates an entity, and optionally assigns all `components` to it.
   * @throws if any component type is duplicated
   */
  create<T extends Component[]>(...components: T): Entity {
    const entity = this.entitySequence++;
    this.entityTracker?.entityAdded?.(entity);
    this.entities.add(entity);

    // Emplace all components into entity.
    // Ensure that types are registered and collect component type names.
    const typesP = this.create_typesP;
    const componentsByTypeByEntity = this.components;
    const nPC = components.length;
    for (let iPC = 0; iPC < nPC; ++iPC) {
      const component = components[iPC];
      component.added?.(entity);
      const type = component.constructor.name;
      const storage = componentsByTypeByEntity[type];
      if (storage == null) componentsByTypeByEntity[type] = {};
      componentsByTypeByEntity[type][entity] = component;
      typesP[iPC] = type;
    }
    // Build the type set by sorting the types and checking for duplicates.
    typesP.length = nPC;
    typesP.sort();
    let prevTypeP: ComponentTypeName | undefined;
    for (let iPC = 0; iPC < nPC; ++iPC) {
      const typeP = typesP[iPC];
      if (typeP === prevTypeP) {
        typesP.length = 0;
        throw new Error(`Duplicate component type ${typeP} in World.create <${typesP}>.`);
      }
      prevTypeP = typeP;
    }
    // For each index with a type set that's a subset of components' type set...
    const ecs = this.create_ecs;
    for (const itI = this.indexByComponentsSubIt.reset(typesP); itI.next(); ) {
      const index = itI.value!;
      // ...gather the components and add to the index.
      const typesI = index.types;
      const nIC = typesI.length;
      for (let iIC = 0; iIC < nIC; ++iIC) {
        ecs[iIC] = componentsByTypeByEntity[typesI[iIC]][entity];
      }
      index.add(entity, ecs);
    }

    // Clean up scratch space.
    typesP.length = 0;
    ecs.length = 0;

    return entity;
  }

  /** @param types ***sorted*** component type names */
  // private updateIndexesWithNewEntity(entity: Entity, types: ComponentTypeName[]) {}

  /**
   * Inserts the `entity`, and optionally assigns all `components` to it.
   *
   * If the entity already exists, all `components` will be assigned to it.
   * If it already has some other components, they won't be destroyed:
   * ```ts
   *  class A { constructor(value = 0) { this.value = value } }
   *  class B { constructor(value = 0) { this.value = value } }
   *  const world = new World;
   *  const entity = world.create(new A, new B);
   *  world.get(entity, A); // A { value: 0 }
   *  world.insert(entity, new A(5));
   *  world.get(entity, A); // A { value: 5 }
   *  world.get(entity, B); // B { value: 0 }
   * ```
   *
   * You can first check if the entity exists, destroy it if so, and then insert it.
   * ```ts
   *  if (world.exists(entity)) {
   *      world.destroy(entity);
   *  }
   *  world.insert(entity, new A, new B, ...);
   * ```
   */
  insert<T extends Component[]>(entity: Entity, ...components: T): Entity {
    // ensure this doesn't break our entity sequence
    if (entity > this.entitySequence) this.entitySequence = entity + 1;
    if (!this.entities.has(entity)) {
      this.entityTracker?.entityAdded?.(entity);
    }
    this.entities.add(entity);
    for (let i = 0, len = components.length; i < len; ++i) {
      // Note: Using emplace updates all the indexes too.
      // TODO-ECS-PERF: Using emplace for each component may not be the most efficient way to update all the indexes.
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
   * Note: `.free()` will be called after the entity is fully destroyed.
   * This is to allow `.destroy()` to be called from a `.free()`
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
    this.entityTracker?.entityRemoved?.(entity);
    this.entities.delete(entity);

    // Call free on each component, and collect component type set.
    // NOTE: We moved this list into destroy() so that destroy can be called from itself.
    // This sometimes happens if a Component's free() calls world.destroy().
    const types: ComponentTypeName[] = [];
    // We call free() only after doing all the other work. This way, we support
    // calling this function from the free() callback.
    const freeComponents: Component[] = [];

    let nC = 0;
    for (const key in this.components) {
      const storage = this.components[key];
      const component = storage[entity];
      if (component != undefined) {
        types[nC++] = component.constructor.name;
        component.removed?.(entity);
        if (component.free != undefined) freeComponents.push(component);
      }
      delete storage[entity];
    }
    types.length = nC;
    types.sort();

    // Remove entity from all indexes with a type set that's a subset of components' type set...
    for (const itI = this.indexByComponentsSubIt.reset(types); itI.next(); ) {
      const index = itI.value!;
      index.remove(entity);
    }

    // Clean up scratch space.
    types.length = 0;

    for (let c = 0; c < freeComponents.length; c++) {
      const component = freeComponents[c];
      if (component.free != undefined) {
        component.free(this, entity);
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
  get<T extends Component>(entity: Entity, componentClass: Constructor<T> | string): T | undefined {
    const type = typeof componentClass === "string" ? componentClass : componentClass.name;
    const storage = this.components[type];
    if (storage === undefined) return undefined;
    return storage[entity] as T | undefined;
  }

  /**
   * Retrieves all components for the given entity. Useful when editing the scene/world.
   * @param entity
   * @returns
   */
  getAll(entity: Entity): Component[] {
    const components = [] as Component[];
    Object.entries(this.components).forEach(([_componentType, componentStorage]) => {
      const component = componentStorage[entity];
      if (component) {
        components.push(component);
      }
    });

    return components;
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
  has<T extends Component>(entity: Entity, componentClass: Constructor<T>): boolean {
    const type = componentClass.name;
    const storage = this.components[type];
    return storage !== undefined && storage[entity] !== undefined;
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
    const type = component.constructor.name;

    if (!this.entities.has(entity)) {
      throw new Error(`Cannot set component "${type}" for dead entity ID ${entity}`);
    }

    const storage = this.components[type];
    if (storage == null) this.components[type] = {};
    this.components[type][entity] = component;
    component.added?.(entity);

    // TODO-ECS-PERF: Is it better to build the entity's component type set and find indexes that match?
    const { components, indexesByComponent, index_ecs: ecs } = this;
    const indexes = indexesByComponent.get(type);
    if (indexes != undefined) {
      const nI = indexes.length;
      indexLoop: for (let iI = 0; iI < nI; ++iI) {
        const index = indexes[iI];
        // If the entity is aready in the index, update the component.
        if (index.emplace(entity, type, component)) continue;
        // Otherwise, gather components for entity, if it has them, and add to index.
        const types = index.types;
        const nC = types.length;
        for (let iC = 0; iC < nC; ++iC) {
          const ec = components[types[iC]][entity];
          if (ec === undefined) continue indexLoop;
          ecs[iC] = ec;
        }
        index.add(entity, ecs);
      }
      ecs.length = 0;
    }
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
   *  world.remove(entity, F)?.free();abc
   * ```
   */
  remove<T extends Component>(entity: Entity, componentClass: Constructor<T> | string): T | undefined {
    const type = typeof componentClass === "string" ? componentClass : componentClass.name;
    const storage = this.components[type];
    if (storage === undefined) return undefined;
    const component = storage[entity] as T | undefined;
    delete storage[entity];
    if (component === undefined) return component;
    component.removed?.(entity);

    // Remove entity from all indexes on type sets including this component type.
    const indexes = this.indexesByComponent.get(type);
    if (indexes === undefined) return component;
    const nI = indexes?.length;
    for (let iI = 0; iI < nI; ++iI) {
      const index = indexes[iI];
      index.remove(entity);
    }
    return component;
  }

  /**
   * Returns the size of the world (how many entities / components are stored)
   */
  size(componentConstructor?: Constructor<Component>): number {
    return componentConstructor == undefined
      ? this.entities.size
      : Object.keys(this.components[componentConstructor.name]).length;
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
        if (this.components[types[i].name] === undefined) {
          this.components[types[i].name] = {};
        }
      }
      this.views[id] = new ViewImpl(this, types);
    }
    return this.views[id];
  }

  /** Gathers spec names and types. */
  private index_specs: IndexComponentSpec[] = [];
  /** Gathers an entity's components to add to index. */
  private index_ecs: Component[] = [];
  /** For sorting [name in index, component class name] pairs by component class name. */
  private index_indexComponentSpecOrd(a: IndexComponentSpec, b: IndexComponentSpec) {
    return a[1] == b[1] ? 0 : a[1] < b[1] ? -1 : 1;
  }

  /** Creates an index for a set of types.
   * @param indexSpec `{ componentName0: ComponentClass0`, ... `}`; `componentNameN` is used in the iteration
   * @throws if there are any duplicate components in types */
  index<IS extends IndexSpec, WithEntity extends boolean>(
    indexSpec: IS,
    _withEntity: WithEntity = false as WithEntity
  ): IndexIterator<IS, WithEntity> {
    // Ensure that types are registered and collect component names as a set of types.
    // TODO-perf: Would modifying the array returned by Object.entries be faster / less garbage?
    const specs = this.index_specs;
    specs.length = 0;
    for (const name of Object.keys(indexSpec)) {
      const type = indexSpec[name].name;
      specs.push([name, type]);
      if (this.components[type] === undefined) this.components[type] = {};
    }
    // Ensure uniqueness by sorting the index spec by type names.
    specs.sort(this.index_indexComponentSpecOrd);
    // Split into names and types.
    // Check for duplicate types.
    const nC = specs.length;
    const names: IndexComponentName[] = [];
    const types: ComponentTypeName[] = new Array(nC);
    let prevType: ComponentTypeName | undefined;
    for (let iC = 0; iC < nC; ++iC) {
      names[iC] = specs[iC][0];
      const type = (types[iC] = specs[iC][1]);
      if (type === prevType) {
        specs.length = 0;
        throw new Error(`Duplicate component type ${type} in index <${indexSpec}>.`);
      }
      prevType = type;
    }
    specs.length = 0;

    // Return existing IndexBase, if any.
    const indexByComponents = this.indexByComponents;
    let indexBase = getInTrie(indexByComponents, types) as IndexBase<Component> | undefined;
    if (indexBase != undefined)
      return new IndexIteratorBase<IS, WithEntity>(indexBase as IndexBase<IS>, names) as IndexIterator<IS, WithEntity>;

    // Construct and remember a new IndexBase.
    indexBase = new IndexBase(types);
    // Enable lookup from the set of component types, for component addition.
    setInTrie(indexByComponents, types, indexBase);
    // Enable lookup from each component type, for component removal.
    const indexesByComponent = this.indexesByComponent;
    for (let i = 0; i < nC; ++i) {
      const c = types[i];
      const indexes = indexesByComponent.get(c);
      if (indexes != undefined) indexes.push(indexBase);
      else indexesByComponent.set(c, [indexBase]);
    }

    // Index existing entities.
    const entities = this.entities;
    const components = this.components;
    const ecs = this.index_ecs;
    // For each entity...
    entityLoop: for (const entity of entities.values()) {
      // ...that has all the components in types...
      for (let iC = 0; iC < nC; ++iC) {
        const ec = components[types[iC]][entity];
        if (ec === undefined) continue entityLoop;
        ecs[iC] = ec;
      }
      // Add entity and components to index.
      indexBase.add(entity, ecs);
    }
    ecs.length = 0;

    // Return the new index.
    return new IndexIteratorBase<IS, WithEntity>(indexBase as IndexBase<IS>, names) as IndexIterator<IS, WithEntity>;
  }

  /**
   * Removes every entity, and destroys all components.
   */
  clear() {
    // TODO-ECS-PERF: Could destroy components more efficiently.
    for (const entity of this.entities.values()) {
      this.destroy(entity);
    }
  }

  /**
   * Returns an iterator over all the entities in the world.
   */
  all(): IterableIterator<Entity> {
    return this.entities.values();
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

type ComponentView<T extends Constructor<Component>[]> = (callback: ViewCallback<T>) => void;
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
    storages += `const ${name} = ${keywords.world}.components["${typeName}"];\n`;
    storageNames.push(name);
  }
  let variables = "";
  const variableNames = [];
  for (let i = 0; i < length; ++i) {
    const typeName = types[i].name;
    const name = `${typeName}${i}`;
    variables += `const ${name} = ${storageNames[i]}[${keywords.entity}];\n`;
    variableNames.push(name);
  }
  let condition = "if (";
  for (let i = 0; i < length; ++i) {
    condition += `${variableNames[i]} === undefined`;
    if (i !== length - 1) condition += ` || `;
  }
  condition += ") continue;\n";

  const fn =
    `${storages}return function(${keywords.callback}) {\n` +
    `for (const ${keywords.entity} of ${keywords.world}.entities.values()) {\n${variables}${condition}if (${
      keywords.callback
    }(${keywords.entity},${join(variableNames, ",")}) === false) return;\n` +
    `}\n` +
    `}`;

  return new Function(keywords.world, fn)(world) as any;
}
