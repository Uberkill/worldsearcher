import { useEffect, useState } from 'react';
import { useEnvironmentStore } from '../stores/environmentSlice';

export const Clock = () => {
  const [timeStr, setTimeStr] = useState('06:00');
  const [dayStr, setDayStr] = useState('Day 1');
  const [isNight, setIsNight] = useState(false);

  useEffect(() => {
    // Subscribe to store changes manually to avoid re-rendering entire component tree on 60fps
    const unsubscribe = useEnvironmentStore.subscribe(
      (state) => ({
        worldTime: state.worldTime,
        daysElapsed: state.daysElapsed,
        isNight: state.isNightTime,
      }),
      (state) => {
        const hours = Math.floor(state.worldTime);
        const minutes = Math.floor((state.worldTime % 1) * 60);
        const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

        setTimeStr(formattedTime);
        setDayStr(`Day ${state.daysElapsed}`);
        setIsNight(state.isNight);
      }
    );
    return () => unsubscribe();
  }, []);

  return (
    <div className="clock-container">
      <div className="clock-day">{dayStr}</div>
      <div className="clock-time">
        {isNight ? '🌙' : '☀️'} {timeStr}
      </div>
    </div>
  );
};
