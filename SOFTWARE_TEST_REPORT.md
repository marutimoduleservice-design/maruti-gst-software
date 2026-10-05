# M5 Repair Software — Module-wise Test Report

**Test date:** 16 September 2026  
**Project:** `m5-repair-software`  
**Test environment:** Clean Linux workspace copy + mounted Windows project validation

## 1. Executive summary

Source code ka TypeScript check **pass** hua aur clean Linux workspace mein production build bhi **successfully complete** hua. Vite development server ne HTTP `200 OK` response diya. Supabase Auth endpoint reachable hai aur HTTP `200` response de raha hai.

Mounted Windows project se direct `npm run build`, `npm run lint` aur Vite start karne par jo errors aaye, woh application source ke compile errors nahi hain; woh mounted filesystem ke `node_modules/.bin` permission aur Vite cache cleanup compatibility errors hain. Isliye actual source/build result clean Linux copy se verify kiya gaya.

## 2. Test results summary

| Check | Result | Details |
|---|---|---|
| TypeScript compiler (`tsc --noEmit`) | **PASS** | 0 TypeScript errors |
| Production build (`tsc -b && vite build`) | **PASS** | 1,891 modules transformed; build completed in 475 ms |
| Vite dev server | **PASS in clean workspace** | `http://127.0.0.1:4173/` returned `HTTP 200 OK` |
| Supabase Auth connectivity | **PASS** | `/auth/v1/settings` returned `HTTP 200` |
| Lint (`oxlint`) | **PASS with warnings** | 0 errors, 15,567 warnings; command scanned 3,178 files including dependencies |
| Dependency audit | **ACTION REQUIRED** | `npm install` reported 3 high-severity vulnerabilities |
| Authenticated CRUD testing | **PENDING** | Valid login credentials/user session available nahi thi |

## 3. Har module ka status

| Module / Menu | Source presence | Static/build status | Runtime note |
|---|---|---|---|
| Login / Forgot Password | Present (`pages/Login.tsx`) | **PASS** | Supabase email auth APIs wired hain; real login/reset submit test credentials ke bina nahi hua |
| Dashboard | Present (`App.tsx`) | **PASS** | Dashboard data fetch ke liye Supabase tables used hain; authenticated session ke bina live data test pending |
| Module Repair / Job Cards | Present (`pages/JobCards.tsx`) | **PASS** | CRUD behavior ko real account ke saath verify karna baaki |
| Sales / Invoice | Present (`pages/Invoices.tsx`) | **PASS** | Invoice aur invoice-items database operations ka authenticated test pending |
| Purchase | Present (`pages/Purchase.tsx`) | **PASS** | Purchase/inward stock operations ka authenticated test pending |
| Payments / Ledger | Present (`pages/PaymentsLedger.tsx`) | **PASS** | Payment allocation/ledger data ka authenticated test pending |
| Bank Passbook & Expenses | Present (`pages/BankPassbook.tsx`) | **PASS** | Bank transaction save/read test credentials ke bina pending |
| Warranty | Present (`pages/Warranty.tsx`) | **PASS** | Runtime data-flow test pending |
| Print Center | Present (`pages/PrintCenter.tsx`) | **PASS** | Browser print/PDF output ka manual test pending |
| Customers | Present (`pages/Customers.tsx`, `CustomerDetails.tsx`) | **PASS** | Customer CRUD ka authenticated test pending |
| Item Master | Present (`pages/ItemMaster.tsx`) | **PASS** | Item CRUD/stock values ka authenticated test pending |
| Customer Wise Price | Present (`pages/CustomerWisePrice.tsx`) | **PASS** | Price mapping test pending |
| Vendor Master | Present (`pages/Vendors.tsx`) | **PASS** | Vendor CRUD test pending |
| Technician Master | Present (`pages/TechnicianMaster.tsx`) | **PASS** | Technician CRUD test pending |
| My Company Details | Present (`pages/MyCompanyDetails.tsx`) | **PASS** | Save/update test pending |
| Stock Report | Present (`pages/Stock.tsx`) | **PASS** | Report calculation compile-safe; live data verification pending |
| Sales Report | Present (`pages/SalesReport.tsx`) | **PASS** | Filter/export behavior pending manual test |
| Purchase Report | Present (`pages/PurchaseReport.tsx`) | **PASS** | Filter/report data pending manual test |
| Expense Report | Present (`pages/ExpenseReport.tsx`) | **PASS** | Bank transaction data ke saath verification pending |
| Net Profit Report | Present (`pages/NetProfitReport.tsx`) | **PASS** | Calculation code compile-safe; accounting data verification pending |
| Item Wise Qty In/Out Report | Present (`pages/ItemWiseQtyInOutReport.tsx`) | **PASS** | Inward/outward stock reconciliation pending |

## 4. Reproduced errors and warnings

### Error 1 — Mounted project mein `tsc: Permission denied`

**Command:** `npm run build`  
**Location:** `package.json` ka `build` script  
**Observed message:** `sh: 1: tsc: Permission denied`

**Cause:** Mounted Windows/FUSE filesystem par `node_modules/.bin/tsc` executable permission correctly preserve nahi ho rahi. Clean Linux workspace mein wahi build successful raha.

**Impact:** Local mounted folder se npm build command run nahi hota; source compile failure nahi hai.

**Recommendation:** Windows machine par project folder ke andar `npm install` dobara run karein, ya Windows terminal/PowerShell se `npm run build` chalayein. Linux sandbox testing ke liye clean local workspace use karein.

### Error 2 — Mounted project mein `oxlint: Permission denied`

**Command:** `npm run lint`  
**Observed message:** `sh: 1: oxlint: Permission denied`

**Cause:** Same mounted filesystem executable-bit issue.

**Impact:** Mounted folder se lint command wrapper execute nahi hota.

**Recommendation:** Windows environment mein dependencies reinstall karke lint chalayein.

### Error 3 — Mounted project mein Vite cache cleanup failure

**Command:** Vite dev server start  
**Observed message:** `Unknown system error -145 ... node_modules/.vite/deps`

**Cause:** Vite dependency cache ko mounted FUSE/Windows filesystem par remove/recreate karte waqt filesystem compatibility issue.

**Impact:** Mounted path se dev server start nahi hua.

**Verification:** Clean Linux copy mein Vite server start hua aur root page ne `HTTP 200 OK` return kiya.

### Warning 4 — Large JavaScript bundle

**Observed during build:** Main JS chunk approximately `827.62 kB` minified, gzip approximately `225.58 kB`; Vite ne `500 kB` threshold warning di.

**Impact:** Build fail nahi hua, lekin initial page load slow ho sakta hai.

**Recommendation:** Pages ko `React.lazy()` / dynamic import se code-split karein; reports aur operational screens ko separate chunks mein load karein.

### Warning 5 — Lint scope dependency files tak expand ho raha hai

**Observed:** `oxlint` ne 3,178 files scan kiye, 0 errors aur 15,567 warnings report kiye. Warnings ka bada hissa `node_modules` ke third-party generated files se aaya.

**Impact:** Project ke actual source warnings alag se clearly visible nahi hain.

**Recommendation:** `.gitignore`/`.oxlintrc` mein `node_modules`, `dist` aur generated files ko ignore karke lint scope sirf `src` tak limit karein.

### Warning 6 — NPM audit vulnerabilities

**Observed:** Dependency install ke baad `3 high severity vulnerabilities` report hui.

**Impact:** Security review required; exact packages ke liye project environment mein `npm audit` run karna chahiye.

**Recommendation:** Pehle `npm audit` se dependency chain identify karein, phir compatible updates/test ke baad `npm audit fix` chalayein. Blind major-version upgrade production se pehle na karein.

## 5. Database/connectivity observation

Supabase Auth endpoint reachable hai aur configured project ka Auth settings response `HTTP 200` de raha hai. REST root endpoint ko direct request par `HTTP 401` mila, lekin Auth endpoint par same publishable key accepted hui. Isliye database table permissions/schema ko actual logged-in user ke saath test karna zaroori hai; is report mein unauthenticated REST `401` ko application bug declare nahi kiya gaya.

## 6. Final conclusion

**Build readiness:** Pass.  
**Static code readiness:** Pass; TypeScript errors nahi mile.  
**Runtime shell readiness:** Pass in clean Linux workspace.  
**Mounted Windows developer workflow:** Permission/cache compatibility issue present.  
**Business-module functional testing:** Login credentials ke bina partially pending; source mein saare listed modules present hain aur build mein compile ho rahe hain.

### Recommended next action

Windows project folder mein `node_modules` remove karke `npm install` run karein, phir `npm run build` aur `npm run lint` chalayein. Complete end-to-end test ke liye ek valid test user ke saath Login karke har menu mein create, edit, delete, print/export aur report reconciliation test karna hoga.
