import { Badge, PriceTag } from "./components/PriceTag.js";
import { mount } from "./runtime.js";

const root = document.getElementById("root");
mount(root, Badge, { text: "new" });
mount(root, PriceTag, { amount: 42 });
