import { useStore } from '../stores/useStore';

export const HealthBar = () => {
  const health = useStore(state => state.playerHealth);
  const maxHealth = useStore(state => state.playerMaxHealth);
  
  const percentage = Math.max(0, Math.min(100, (health / maxHealth) * 100));

  // Calculate color based on percentage
  let color = '#00ffcc'; // Sci-fi cyan
  if (percentage <= 50) color = '#ffaa00'; // Orange
  if (percentage <= 20) color = '#ff0055'; // Neon Red
  
  return (
    <div className="health-bar-wrapper">
      <div className="health-bar-bg">
        <div 
          className="health-bar-fill" 
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
      <div className="health-text">INTEGRITY: {health}/{maxHealth}</div>
    </div>
  );
};
