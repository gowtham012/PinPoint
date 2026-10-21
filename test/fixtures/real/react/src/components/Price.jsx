// An arrow-function component: its name lives only on the `const` binding.
const Price = ({ value }) => {
  const label = "$" + value.toFixed(2);
  return <span className="price">{label}</span>;
};

export default Price;
