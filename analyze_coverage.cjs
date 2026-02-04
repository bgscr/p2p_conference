
const fs = require('fs');
const path = require('path');

const coveragePath = path.join(__dirname, 'coverage/coverage-final.json');

try {
    const data = fs.readFileSync(coveragePath, 'utf8');
    const coverage = JSON.parse(data);

    console.log('Files with low coverage:');

    Object.keys(coverage).forEach(filePath => {
        const fileCoverage = coverage[filePath];
        // istanbul format usually has s (statements), f (functions), b (branches) maps and counts
        // but v8 provider might differ. Let's assume standard istanbul-like structure or try to deduce.

        // Actually, vitest v8 provider with "all: true" and reporter "json" generates coverage-final.json in istanbul format if using specific options, but let's check content first. 
        // If it's pure v8, it might be different.
        // However, "coverage-final.json" is typically used by istanbul reports.

        let totalStatements = 0;
        let coveredStatements = 0;
        let totalBranches = 0;
        let coveredBranches = 0;
        let totalFunctions = 0;
        let coveredFunctions = 0;

        if (fileCoverage.s) {
            Object.values(fileCoverage.s).forEach(c => { totalStatements++; if (c > 0) coveredStatements++; });
        }
        if (fileCoverage.f) {
            Object.values(fileCoverage.f).forEach(c => { totalFunctions++; if (c > 0) coveredFunctions++; });
        }
        if (fileCoverage.b) {
            Object.values(fileCoverage.b).forEach(c => {
                // branches are arrays [count, count, ...]
                if (Array.isArray(c)) {
                    c.forEach(branchCount => {
                        totalBranches++;
                        if (branchCount > 0) coveredBranches++;
                    });
                }
            });
        }

        const sPct = totalStatements ? (coveredStatements / totalStatements * 100) : 100;
        const fPct = totalFunctions ? (coveredFunctions / totalFunctions * 100) : 100;
        const bPct = totalBranches ? (coveredBranches / totalBranches * 100) : 100;

        if (sPct < 100 || fPct < 100 || bPct < 100) {
            console.log(`\n${path.relative('d:/prj/p2p_conference/code', filePath)}`);
            console.log(`  Statements: ${coveredStatements}/${totalStatements} (${sPct.toFixed(2)}%)`);
            console.log(`  Branches:   ${coveredBranches}/${totalBranches} (${bPct.toFixed(2)}%)`);
            console.log(`  Functions:  ${coveredFunctions}/${totalFunctions} (${fPct.toFixed(2)}%)`);

            // Print missing lines/branches if possible (requires more complex parsing of maps)
            // For now just list the files.
        }
    });

} catch (err) {
    console.error('Error reading coverage:', err);
}
