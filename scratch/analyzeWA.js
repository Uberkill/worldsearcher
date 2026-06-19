const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const code = fs.readFileSync('src/stores/worldActions.js', 'utf8');

const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx']
});

const topLevelVars = new Set();
const returnedKeys = [];
let worldActionsNodePath = null;

traverse(ast, {
  VariableDeclarator(path) {
    if (path.parentPath.parentPath.isProgram()) {
      topLevelVars.add(path.node.id.name);
    }
  },
  ExportNamedDeclaration(path) {
    if (path.node.declaration && path.node.declaration.declarations) {
      const name = path.node.declaration.declarations[0].id.name;
      if (name === 'worldActions') {
        worldActionsNodePath = path;
      }
    }
  },
  ReturnStatement(path) {
    // find the return object inside worldActions
    if (worldActionsNodePath && path.findParent(p => p === worldActionsNodePath)) {
      if (path.node.argument && path.node.argument.type === 'ObjectExpression') {
        path.node.argument.properties.forEach(prop => {
          if (prop.key && prop.key.name) {
            returnedKeys.push(prop.key.name);
          }
        });
        path.stop();
      }
    }
  }
});

console.log("Top-level vars:", Array.from(topLevelVars));
console.log("Returned actions:", returnedKeys);
