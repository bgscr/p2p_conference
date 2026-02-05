#!/bin/bash

# React Performance Audit Script
#
# This script helps identify common performance issues in React projects.
# Run from your project root directory.
#
# Usage: bash perf-audit.sh [path-to-src]
#
# Requirements: grep, find, wc (standard Unix tools)

set -e

SRC_DIR="${1:-./src}"
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "🔍 React Performance Audit"
echo "=========================="
echo "Scanning: $SRC_DIR"
echo ""

# Track issues found
ISSUES=0

# Check for inline objects in JSX
echo "📋 Checking for inline objects in JSX props..."
INLINE_OBJECTS=$(grep -rn "={{\s*" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | grep -v "style=" | wc -l || echo "0")
if [ "$INLINE_OBJECTS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $INLINE_OBJECTS potential inline objects in JSX${NC}"
    echo "   Tip: Extract to useMemo or const outside component"
    grep -rn "={{\s*" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | grep -v "style=" | head -5
    ISSUES=$((ISSUES + 1))
else
    echo -e "${GREEN}✅ No inline object issues found${NC}"
fi
echo ""

# Check for inline arrow functions in JSX
echo "📋 Checking for inline functions in JSX props..."
INLINE_FUNCTIONS=$(grep -rn "={() =>" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | wc -l || echo "0")
if [ "$INLINE_FUNCTIONS" -gt 10 ]; then
    echo -e "${YELLOW}⚠️  Found $INLINE_FUNCTIONS inline arrow functions${NC}"
    echo "   Tip: Use useCallback for handlers passed to memoized children"
    grep -rn "={() =>" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | head -5
    ISSUES=$((ISSUES + 1))
else
    echo -e "${GREEN}✅ Inline function count is acceptable ($INLINE_FUNCTIONS)${NC}"
fi
echo ""

# Check for index as key
echo "📋 Checking for array index as key..."
INDEX_KEYS=$(grep -rn "key={.*index" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | wc -l || echo "0")
INDEX_KEYS2=$(grep -rn "key={i}" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | wc -l || echo "0")
TOTAL_INDEX=$((INDEX_KEYS + INDEX_KEYS2))
if [ "$TOTAL_INDEX" -gt 0 ]; then
    echo -e "${RED}❌ Found $TOTAL_INDEX instances of index as key${NC}"
    echo "   Tip: Use unique, stable IDs instead"
    grep -rn "key={.*index\|key={i}" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | head -5
    ISSUES=$((ISSUES + 1))
else
    echo -e "${GREEN}✅ No index-as-key issues found${NC}"
fi
echo ""

# Check for missing memo on frequently used components
echo "📋 Checking component memoization..."
TOTAL_COMPONENTS=$(grep -rn "^export function\|^export const.*= (" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | wc -l || echo "0")
MEMOIZED=$(grep -rn "memo(" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | wc -l || echo "0")
echo "   Total exported components: $TOTAL_COMPONENTS"
echo "   Memoized components: $MEMOIZED"
if [ "$TOTAL_COMPONENTS" -gt 0 ]; then
    RATIO=$((MEMOIZED * 100 / TOTAL_COMPONENTS))
    echo "   Memoization ratio: ${RATIO}%"
fi
echo ""

# Check for large component files
echo "📋 Checking for large component files (>300 lines)..."
LARGE_FILES=$(find "$SRC_DIR" -name "*.tsx" -o -name "*.jsx" 2>/dev/null | xargs wc -l 2>/dev/null | awk '$1 > 300 && !/total/' | wc -l || echo "0")
if [ "$LARGE_FILES" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $LARGE_FILES large component files${NC}"
    echo "   Tip: Consider splitting into smaller components"
    find "$SRC_DIR" -name "*.tsx" -o -name "*.jsx" 2>/dev/null | xargs wc -l 2>/dev/null | awk '$1 > 300 && !/total/' | sort -rn | head -5
    ISSUES=$((ISSUES + 1))
else
    echo -e "${GREEN}✅ No overly large components found${NC}"
fi
echo ""

# Check for console.log statements
echo "📋 Checking for console.log statements..."
CONSOLE_LOGS=$(grep -rn "console\.log" "$SRC_DIR" --include="*.tsx" --include="*.jsx" --include="*.ts" --include="*.js" 2>/dev/null | grep -v "node_modules" | wc -l || echo "0")
if [ "$CONSOLE_LOGS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $CONSOLE_LOGS console.log statements${NC}"
    echo "   Tip: Remove before production or use conditional logging"
    ISSUES=$((ISSUES + 1))
else
    echo -e "${GREEN}✅ No console.log statements found${NC}"
fi
echo ""

# Check for useEffect without dependencies
echo "📋 Checking for useEffect with empty array deps that might be missing deps..."
EFFECTS=$(grep -rn "useEffect(" "$SRC_DIR" --include="*.tsx" --include="*.jsx" 2>/dev/null | wc -l || echo "0")
echo "   Total useEffect hooks: $EFFECTS"
echo ""

# Summary
echo "=========================="
echo "📊 Audit Summary"
echo "=========================="
if [ "$ISSUES" -eq 0 ]; then
    echo -e "${GREEN}✅ No major issues found!${NC}"
else
    echo -e "${YELLOW}⚠️  Found $ISSUES categories with potential issues${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run React DevTools Profiler to measure actual impact"
    echo "2. Focus on components that render frequently"
    echo "3. Address issues in hot paths first"
fi
echo ""
echo "For detailed profiling, use:"
echo "  - React DevTools Profiler"
echo "  - Chrome DevTools Performance tab"
echo "  - Lighthouse CI"
