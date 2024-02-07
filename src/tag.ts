import type { Constructor } from "./util";

type TagName = string | number | { toString(): string };

export interface EntityTag<Name extends TagName> {
  /**
   * Don't try to use this, it only exists to preserve the type parameter.
   */
  __$PHANTOM$: Name & never;
}

export abstract class Tag {
  private static cache: { [id: string]: [Constructor<EntityTag<TagName>>, EntityTag<TagName>] } = {};

  /**
   * This can be used to assign an entity a
   * unique component type, for identification
   * purposes.
   *
   * Example:
   * ```
   *  const registry = new Registry();
   *  // create
   *  const enemy = registry.create(Tag.for("Enemy"));
   *  const player = registry.create(Tag.for("Player"));
   *
   *  // query
   *  registry.view(Tag.for("Enemy")).each(() => { ... });
   *  registry.view(Tag.for("Player")).each(() => { ... });
   * ```
   */
  static typeFor<Name extends TagName>(name: Name): Constructor<EntityTag<Name>> {
    return this.ensure(name)[0];
  }

  static instFor<Name extends TagName>(name: Name): EntityTag<Name> {
    return this.ensure(name)[1];
  }

  private static ensure<Name extends TagName>(name: Name): [Constructor<EntityTag<Name>>, EntityTag<Name>] {
    const n = name.toString();
    let tci = Tag.cache[n];
    if (tci == null) {
      const tc = Object.defineProperty(class {}, "name", { value: `T$${n}` });
      const ti = new tc();
      Tag.cache[n] = tci = [tc as Constructor<EntityTag<TagName>>, ti as EntityTag<Name>];
    }
    return tci;
  }
}
