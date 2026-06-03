import sys

with open('src/stores/createWorldSlice.js', 'r') as f:
    lines = f.readlines()

new_content = """      if (chunk.meshArrays.__flora) {
        newMeshArrays.__flora = chunk.meshArrays.__flora;
      }

      return {
        chunks: {
          ...prev.chunks,
          [chunkKey]: {
            ...chunk,
            meshArrays: newMeshArrays,
          },
        },
      };
    }),

  applyNetworkSync: (chunksData) => {
    set((prev) => {
      const newChunks = { ...prev.chunks };
      let updated = false;

      for (const chunkKey in chunksData) {
        const incoming = chunksData[chunkKey];
        const current = prev.chunks[chunkKey];

        if (!current) {
          const newBuffer = new Uint8Array(incoming.buffer);
          newChunks[chunkKey] = {
"""

# The line 386 is index 386 in 0-based Python if we readlines.
# Let's find the exact index.
idx = -1
for i, line in enumerate(lines):
    if 'newMeshArrays.__flora = chunk.meshArrays.__flora;' in line:
        idx = i
        break

if idx != -1:
    lines[idx] = new_content
    # delete the '          newChunks[chunkKey] = {' line
    del lines[idx+1]
    with open('src/stores/createWorldSlice.js', 'w') as f:
        f.writelines(lines)
    print("Fixed!")
else:
    print("Not found!")
