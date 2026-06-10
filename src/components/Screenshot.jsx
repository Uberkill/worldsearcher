import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

export const Screenshot = () => {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    const handleKeyDown = async (e) => {
      if (e.key.toLowerCase() === 'p') {
        if (
          document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA'
        )
          return;

        // Force a render so the buffer isn't clear when we capture it
        gl.render(scene, camera);

        try {
          const dataURL = gl.domElement.toDataURL('image/png');
          const link = document.createElement('a');
          link.download = `minecraft-clone-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
          link.href = dataURL;
          link.click();
        } catch (err) {
          console.error('Failed to capture screenshot:', err);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gl, scene, camera]);

  return null;
};
