import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('Engine GC Memory Allocation', () => {
  it('prevents GC stutter by avoiding allocations in runVisualTick (144Hz)', () => {
    const code = fs.readFileSync(path.join(__dirname, '../../src/hooks/usePlayerPhysics.ts'), 'utf-8');
    
    // Extract the body of runVisualTick
    const startIdx = code.indexOf('function runVisualTick');
    const endIdx = code.indexOf('function corePhysicsStep');
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    
    const runVisualTickBlock = code.substring(startIdx, endIdx);
    
    // Verify that the function doesn't instantiate new objects inside the hot loop
    expect(runVisualTickBlock).not.toContain('.clone()');
    expect(runVisualTickBlock).not.toContain('new Vector3');
    expect(runVisualTickBlock).not.toContain('new Euler');
    expect(runVisualTickBlock).not.toContain('new Quaternion');
  });

  it('reuses _sharedPhysicsSet in ChunkManager to prevent 20Hz Set allocations', () => {
    const code = fs.readFileSync(path.join(__dirname, '../../src/components/ChunkManager.jsx'), 'utf8');
    
    // Extract the body of updatePhysicsGrid
    const startIdx = code.indexOf('const updatePhysicsGrid');
    const endIdx = code.indexOf('const renderDistance'); // checkPass2Gate was hoisted, renderDistance is the next declaration
    expect(startIdx).toBeGreaterThan(-1);
    
    const block = code.substring(startIdx, endIdx > -1 ? endIdx : undefined);
    
    // Assert the memory fix is present
    expect(block).not.toContain('new Set()');
    expect(block).toContain('_sharedPhysicsSet.clear()');
  });
});
