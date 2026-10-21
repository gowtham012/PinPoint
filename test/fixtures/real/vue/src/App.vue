<script setup>
import PriceCard from "./components/PriceCard.vue";

const items = ["Kettle", "Toaster", "Blender"].map((title, i) => ({ id: i, title, price: 10 + i * 5 }));
</script>

<template>
  <main>
    <h1 class="site-title">Shop</h1>
    <section class="grid">
      <PriceCard v-for="p in items" :key="p.id" :title="p.title" :price="p.price" />
    </section>
  </main>
</template>
