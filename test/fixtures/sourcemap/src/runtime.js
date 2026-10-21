// Mirrors what React leaves on a DOM node: __reactFiber$<random> pointing at the host fiber, whose
// .return is the component's fiber with .type = the component function. No _debugSource: that is
// exactly what a production build strips.
export function mount(root, Component, props) {
  const el = Component(props);
  el["__reactFiber$pp" + Math.random().toString(36).slice(2)] = { type: el.tagName.toLowerCase(), return: { type: Component, return: null } };
  root.append(el);
}
