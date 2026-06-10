import { useEffect } from 'react';
import { useStore } from '../stores/useStore';
import { motion, AnimatePresence } from 'framer-motion';

export const AchievementPopup = () => {
  const recentAchievement = useStore((state) => state.recentAchievement);
  const clearRecentAchievement = useStore(
    (state) => state.clearRecentAchievement
  );

  useEffect(() => {
    if (recentAchievement) {
      const timer = setTimeout(() => {
        clearRecentAchievement();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [recentAchievement, clearRecentAchievement]);

  return (
    <AnimatePresence>
      {recentAchievement && (
        <motion.div
          initial={{ y: -100, opacity: 0, x: '-50%' }}
          animate={{ y: 20, opacity: 1, x: '-50%' }}
          exit={{ y: -100, opacity: 0, x: '-50%' }}
          transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            backgroundColor: 'rgba(30, 41, 59, 0.95)',
            border: '2px solid #fbbf24',
            borderRadius: '8px',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            zIndex: 10000,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: '32px' }}>
            {recentAchievement.icon || '🏆'}
          </div>
          <div>
            <div
              style={{
                color: '#fbbf24',
                fontSize: '14px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              Achievement Get!
            </div>
            <div
              style={{
                color: '#fff',
                fontSize: '18px',
                fontFamily: 'monospace',
              }}
            >
              {recentAchievement.title}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
