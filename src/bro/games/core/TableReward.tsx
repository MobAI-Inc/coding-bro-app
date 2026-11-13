import { motion } from "framer-motion";
import "./table-feedback.css";

export function TableReward({ points }: { readonly points: number }) {
  if (points <= 0) return null;
  return (
    <motion.div
      className="bro-table-reward"
      aria-live="polite"
      aria-label={`积分入账 ${points}`}
      initial={{ opacity: 0, scale: 0.72, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 18 }}
    >
      <i aria-hidden="true" />
      <span>积分入账</span>
      <strong className="bro-tabular">+{points}</strong>
      <b aria-hidden="true" />
    </motion.div>
  );
}
