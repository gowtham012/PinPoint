<script setup>
import { computed } from "vue";

const props = defineProps({ title: String, price: Number });
const label = computed(() => "$" + props.price.toFixed(2));
</script>

<template>
  <div class="card">
    <h3 class="card-title">{{ title }}</h3>
    <span class="price">{{ label }}</span>
  </div>
</template>
