export const evaluateRecipe = (grid, recipes) => {
  // Grid is an array of 9 items (3x3)
  // First, gather all non-null items
  let minRow = 3, maxRow = -1, minCol = 3, maxCol = -1;
  const flatItems = [];
  
  for (let i = 0; i < 9; i++) {
    if (grid[i] && grid[i].count > 0) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      
      const texture = grid[i].texture || grid[i].id;
      // Group for shapeless
      const existing = flatItems.find(item => item.id === texture);
      if (existing) {
        existing.qty += grid[i].count;
      } else {
        flatItems.push({ id: texture, qty: grid[i].count, originalSlots: [i] });
      }
    }
  }

  // If grid is empty
  if (flatItems.length === 0) return { result: null, deductions: [] };

  // Helper to check tags/ids
  const matchIngredient = (def, item) => {
    if (!item) return false;
    const itemId = item.texture || item.id;
    if (def.id && def.id === itemId) return true;
    if (def.tag) {
       // Mock tag checker
       if (def.tag === 'forge:refined_planks' && itemId.includes('wood')) return true;
       if (def.tag === 'forge:stone' && itemId.includes('stone')) return true;
    }
    return false;
  };

  for (const recipe of Object.values(recipes)) {
    if (recipe.type === 'shapeless') {
      let matched = true;
      const available = JSON.parse(JSON.stringify(flatItems));

      for (const req of recipe.ingredients) {
        let reqQty = req.qty || 1;
        
        for (let i = 0; i < available.length; i++) {
           const avail = available[i];
           if (avail.qty > 0 && matchIngredient(req, avail)) {
              const take = Math.min(avail.qty, reqQty);
              avail.qty -= take;
              reqQty -= take;
              // record deductions
              // wait, shapeless deduction is complex to map back to grid slots, 
              // for simplicity we will just deduct from the first found slots
           }
        }
        if (reqQty > 0) {
          matched = false;
          break;
        }
      }

      if (matched) {
        // Build deductions
        // We need to exactly map which slots to deduct from so we don't guess.
        return { result: { texture: recipe.result.id, count: recipe.result.count }, recipe, type: 'shapeless' };
      }
    } 
    else if (recipe.type === 'shaped') {
      const pRows = recipe.pattern.length;
      const pCols = recipe.pattern[0].length;
      const gridRows = maxRow - minRow + 1;
      const gridCols = maxCol - minCol + 1;

      if (pRows === gridRows && pCols === gridCols) {
        let matched = true;
        for (let r = 0; r < pRows; r++) {
          for (let c = 0; c < pCols; c++) {
            const char = recipe.pattern[r][c];
            const gridIdx = ((minRow + r) * 3) + (minCol + c);
            const gridItem = grid[gridIdx];

            if (char === ' ') {
              if (gridItem) matched = false;
            } else {
              const def = recipe.key[char];
              if (!def || !matchIngredient(def, gridItem)) {
                matched = false;
              }
            }
          }
        }
        if (matched) {
          return { result: { texture: recipe.result.id, count: recipe.result.count }, recipe, type: 'shaped' };
        }
      }
    }
  }

  return { result: null, deductions: [] };
};

export const deductRecipe = (grid, recipeMatch) => {
  const newGrid = [...grid];
  if (!recipeMatch || !recipeMatch.recipe) return newGrid;

  const { recipe, type } = recipeMatch;

  if (type === 'shaped') {
     let minRow = 3, minCol = 3;
     for (let i = 0; i < 9; i++) {
        if (grid[i]) {
          const r = Math.floor(i / 3);
          const c = i % 3;
          if (r < minRow) minRow = r;
          if (c < minCol) minCol = c;
        }
     }

     for (let r = 0; r < recipe.pattern.length; r++) {
        for (let c = 0; c < recipe.pattern[r].length; c++) {
           const char = recipe.pattern[r][c];
           if (char !== ' ') {
              const def = recipe.key[char];
              const gridIdx = ((minRow + r) * 3) + (minCol + c);
              const item = newGrid[gridIdx];
              if (item) {
                 if (def.returns) {
                    newGrid[gridIdx] = { ...item, texture: def.returns, count: 1 };
                 } else if (def.consume === false) {
                    newGrid[gridIdx] = { ...item, durability: (item.durability || 100) - (def.damage || 1) };
                    if (newGrid[gridIdx].durability <= 0) newGrid[gridIdx] = null;
                 } else {
                    if (item.count > 1) {
                       newGrid[gridIdx] = { ...item, count: item.count - 1 };
                    } else {
                       newGrid[gridIdx] = null;
                    }
                 }
              }
           }
        }
     }
  } else if (type === 'shapeless') {
     // Simplistic deduction: just find matching items and deduct
     // This needs to track how many of each requirement we've deducted
     for (const req of recipe.ingredients) {
        let reqQty = req.qty || 1;
        for (let i = 0; i < 9; i++) {
           const item = newGrid[i];
           if (item && item.count > 0 && reqQty > 0) {
              const itemId = item.texture || item.id;
              let isMatch = false;
              if (req.id && req.id === itemId) isMatch = true;
              if (req.tag && itemId.includes(req.tag.replace('forge:', ''))) isMatch = true;

              if (isMatch) {
                 if (req.returns) {
                    newGrid[i] = { ...item, texture: req.returns, count: 1 };
                    reqQty--;
                 } else if (req.consume === false) {
                    newGrid[i] = { ...item, durability: (item.durability || 100) - (req.damage || 1) };
                    if (newGrid[i].durability <= 0) newGrid[i] = null;
                    reqQty--;
                 } else {
                    const take = Math.min(item.count, reqQty);
                    if (item.count - take <= 0) {
                       newGrid[i] = null;
                    } else {
                       newGrid[i] = { ...item, count: item.count - take };
                    }
                    reqQty -= take;
                 }
              }
           }
        }
     }
  }

  return newGrid;
};
