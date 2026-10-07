import { sc } from "../lib/company";
import { useEffect, useMemo, useState } from "react";
import { SortTh, useSortedRows } from "../lib/tableSort";
import CustomerDetails, { type Customer } from "./CustomerDetails";

const paymentTerms = [
  "Cash",
  "7 Days",
  "15 Days",
  "30 Days",
  "45 Days",
  "60 Days",
  "90 Days",
  "10th Of Every Next Month",
];

// CSV Line Parser (Handles commas inside quotes like in addresses)
const parseCSVLine = (text: string): string[] => {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(cur.trim().replace(/^"|"$/g, ""));
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim().replace(/^"|"$/g, ""));
  return result;
};

// Mobile ko 10-digit form me normalize karta hai
// "+91 98765-43210" / "09876543210" / "919876543210" -> "9876543210"
const normalizeMobile = (raw: string): string => {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
};

// Excel ka "NA" / "N/A" / "-" / "nil" ko blank maan lete hain
const isBlankValue = (raw: string): boolean => {
  const value = (raw || "").trim();
  return (
    value === "" || /^(n\/?a|none|nil|not available|unknown|-)$/i.test(value)
  );
};

function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] =
    useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] =
    useState<Customer | null>(null);

  const [search, setSearch] = useState("");
  const [filterPayment, setFilterPayment] = useState("All");
  const [filterGST, setFilterGST] = useState("All");

  const [customerName, setCustomerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [gstAvailable, setGstAvailable] = useState(false);
  const [gstNumber, setGstNumber] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("Cash");

  // --------------------------------------------------
  // LOAD CUSTOMERS
  // --------------------------------------------------

  const loadCustomers = async () => {
    setLoading(true);

    const { data, error } = await sc("customers")
      .select(`
        id,
        customer_code,
        customer_name,
        mobile,
        business_name,
        business_address,
        gst_available,
        gst_number,
        payment_term
      `)
      .order("business_name", { ascending: true });

    if (error) {
      console.error(error);
      alert("Customer data load nahi hua.\n\n" + error.message);
    } else {
      setCustomers((data || []) as Customer[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // --------------------------------------------------
  // FORM RESET
  // --------------------------------------------------

  const resetForm = () => {
    setCustomerName("");
    setMobile("");
    setBusinessName("");
    setBusinessAddress("");
    setGstAvailable(false);
    setGstNumber("");
    setPaymentTerm("Cash");
    setEditingCustomer(null);
  };

  // --------------------------------------------------
  // OPEN ADD FORM
  // --------------------------------------------------

  const openAddForm = () => {
    resetForm();
    setShowForm(true);
  };

  // --------------------------------------------------
  // OPEN EDIT FORM
  // --------------------------------------------------

  const openEditForm = (customer: Customer) => {
    setEditingCustomer(customer);

    setCustomerName(customer.customer_name || "");
    setMobile(customer.mobile || "");
    setBusinessName(customer.business_name || "");
    setBusinessAddress(customer.business_address || "");
    setGstAvailable(customer.gst_available);
    setGstNumber(customer.gst_number || "");
    setPaymentTerm(customer.payment_term || "Cash");

    setShowForm(true);
  };

  // --------------------------------------------------
  // NEXT CUSTOMER CODE
  // --------------------------------------------------

  const getNextCustomerCode = async () => {
    const { data, error } = await sc("customers")
      .select("customer_code")
      .not("customer_code", "is", null);

    if (error) {
      throw new Error(error.message);
    }

    const lastCode = (data || []).reduce(
      (max, row) => Math.max(max, Number(row.customer_code) || 0),
      0
    );

    return lastCode + 1;
  };

  // --------------------------------------------------
  // SAVE CUSTOMER
  // --------------------------------------------------

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!customerName.trim()) {
      alert("Customer Name enter karein.");
      return;
    }

    if (
      mobile.trim() &&
      !/^[0-9+\-\s]{7,15}$/.test(mobile.trim())
    ) {
      alert("Mobile number check karein.");
      return;
    }

    if (gstAvailable && !gstNumber.trim()) {
      alert("GST Number enter karein.");
      return;
    }

    // --- DUPLICATE MOBILE CHECK ---
    if (mobile.trim()) {
      const isDuplicate = customers.some(
        (customer) =>
          customer.mobile === mobile.trim() &&
          (!editingCustomer || customer.id !== editingCustomer.id)
      );

      if (isDuplicate) {
        alert("Yeh mobile number pehle se ek customer ke paas registered hai. Kripya naya number dalein.");
        return;
      }
    }

    setSaving(true);

    try {
      const customerData = {
        customer_name: customerName.trim(),
        mobile: mobile.trim() || null,
        business_name: businessName.trim() || null,
        business_address: businessAddress.trim() || null,
        gst_available: gstAvailable,
        gst_number: gstAvailable
          ? gstNumber.trim().toUpperCase()
          : null,
        payment_term: paymentTerm,
      };

      if (editingCustomer) {
        const { error } = await sc("customers")
          .update(customerData)
          .eq("id", editingCustomer.id);

        if (error) {
          throw new Error(error.message);
        }

        alert("Customer successfully updated.");
      } else {
        const nextCustomerCode = await getNextCustomerCode();

        const { error } = await sc("customers")
          .insert([
            {
              customer_code: nextCustomerCode,
              ...customerData,
            },
          ]);

        if (error) {
          throw new Error(error.message);
        }

        alert(
          `Customer successfully save ho gaya.\n\nCustomer Code: C${String(
            nextCustomerCode
          ).padStart(4, "0")}`
        );
      }

      resetForm();
      setShowForm(false);

      await loadCustomers();
    } catch (error) {
      console.error(error);

      alert(
        "Customer save nahi hua.\n\n" +
          (error instanceof Error
            ? error.message
            : "Unknown error")
      );
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------
  // BULK CSV UPLOAD HANDLER
  // --------------------------------------------------

  const handleBulkUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileInput = event.target;
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        setUploading(true);
        const text = (e.target?.result as string) || "";
        const lines = text.split(/\r?\n/);
        if (lines.length < 2) {
          alert("CSV file khali hai ya proper format me nahi hai.");
          return;
        }

        const headers = parseCSVLine(lines[0]).map((h) =>
          h.trim().toLowerCase().replace(/^\ufeff/, "")
        );

        const { data: existingRows, error: existingError } = await sc("customers")
          .select("mobile");

        if (existingError) throw existingError;

        const existingMobiles = new Set(
          (existingRows || [])
            .map((row) => normalizeMobile(row.mobile as string))
            .filter((m) => m.length > 0)
        );

        let nextCode = await getNextCustomerCode();
        const batchData: any[] = [];
        const skipped: string[] = [];
        const notes: string[] = [];
        const seenInFile = new Set<string>();

        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = parseCSVLine(lines[i]);
          const rowNo = i + 1;

          const cust: any = {
            customer_code: nextCode++,
            payment_term: "Cash",
            gst_available: false,
          };

          headers.forEach((header, index) => {
            const val = (values[index] || "").trim();

            if (header.includes("address")) {
              cust.business_address = val || null;
            } else if (header.includes("business")) {
              cust.business_name = val || null;
            } else if (header.includes("name") && !header.includes("business")) {
              cust.customer_name = val;
            } else if (header.includes("mobile") || header.includes("phone")) {
              cust.mobile = val || null;
            } else if (header.includes("payment")) {
              cust.payment_term = val || "Cash";
            } else if (header.includes("gst_number") || header.includes("gst number")) {
              cust.gst_number = val ? val.toUpperCase() : null;
              if (val) cust.gst_available = true;
            } else if (header.includes("gst") && !header.includes("number")) {
              cust.gst_available =
                val.toLowerCase() === "true" || val === "1" || val.toLowerCase() === "yes";
            }
          });

          if (isBlankValue(cust.customer_name)) {
            const fallback = isBlankValue(cust.business_name)
              ? ""
              : cust.business_name;
            if (!fallback) {
              skipped.push(`Row ${rowNo}: customer name aur business name dono khaali hain`);
              continue;
            }
            notes.push(`Row ${rowNo} (${fallback}): naam khaali tha, business name use kiya`);
            cust.customer_name = fallback;
          }

          if (cust.mobile && isBlankValue(cust.mobile)) {
            cust.mobile = null;
          }

          if (cust.mobile) {
            const mobile = normalizeMobile(cust.mobile);

            if (!/^[0-9]{7,15}$/.test(mobile)) {
              skipped.push(`Row ${rowNo} (${cust.customer_name}): mobile "${cust.mobile}" invalid hai`);
              continue;
            }

            if (existingMobiles.has(mobile)) {
              skipped.push(`Row ${rowNo} (${cust.customer_name}): mobile ${mobile} database me pehle se hai`);
              continue;
            }

            if (seenInFile.has(mobile)) {
              skipped.push(`Row ${rowNo} (${cust.customer_name}): mobile ${mobile} is file me dobara aa gaya`);
              continue;
            }

            seenInFile.add(mobile);
            cust.mobile = mobile;
          }

          batchData.push(cust);
        }

        if (batchData.length === 0) {
          alert(
            ["CSV me koi valid customer nahi mila.", ...skipped.slice(0, 15)].join("\n")
          );
          return;
        }

        let inserted = 0;
        const failed: string[] = [];

        for (let i = 0; i < batchData.length; i += 200) {
          const chunk = batchData.slice(i, i + 200);
          const { error } = await sc("customers").insert(chunk);

          if (!error) {
            inserted += chunk.length;
            continue;
          }

          for (const row of chunk) {
            const { error: rowError } = await sc("customers")
              .insert([row]);

            if (rowError) {
              failed.push(
                `${row.customer_name} (${row.mobile || "no mobile"}): ${rowError.message}`
              );
            } else {
              inserted += 1;
            }
          }
        }

        await loadCustomers();

        const report = [
          `${inserted} customers upload ho gaye.`,
          notes.length ? `${notes.length} rows me naam badla:` : "",
          ...notes.slice(0, 8),
          notes.length > 8 ? `...aur ${notes.length - 8} rows` : "",
          skipped.length ? `${skipped.length} rows skip ki gayi:` : "",
          ...skipped.slice(0, 10),
          skipped.length > 10 ? `...aur ${skipped.length - 10} rows` : "",
          failed.length ? `${failed.length} rows save nahi hui:` : "",
          ...failed.slice(0, 5),
          failed.length > 5 ? `...aur ${failed.length - 5} rows` : "",
        ].filter(Boolean);

        alert(report.join("\n"));
      } catch (error: any) {
        console.error("CSV Upload Error:", error);
        alert("Upload karne me error aayi: " + error.message);
      } finally {
        setUploading(false);
        fileInput.value = "";
      }
    };
    reader.readAsText(file);
  };

  // --------------------------------------------------
  // DELETE CUSTOMER
  // --------------------------------------------------

  const handleDelete = async (id: number) => {
    const customer = customers.find(
      (item) => item.id === id
    );

    const confirmDelete = window.confirm(
      `Delete customer?\n\n${
        customer?.customer_name || "Customer"
      }`
    );

    if (!confirmDelete) return;

    const { error } = await sc("customers")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      alert(
        "Customer delete nahi hua.\n\n" +
          error.message
      );
      return;
    }

    await loadCustomers();
  };

  // --------------------------------------------------
  // FILTERED CUSTOMERS
  // --------------------------------------------------

  const filteredCustomers = useMemo(() => {
    const text = search.toLowerCase().trim();

    return customers.filter((customer) => {
      const matchesSearch =
        !text ||
        String(customer.customer_code || "")
          .toLowerCase()
          .includes(text) ||
        (customer.customer_name || "")
          .toLowerCase()
          .includes(text) ||
        (customer.mobile || "")
          .toLowerCase()
          .includes(text) ||
        (customer.business_name || "")
          .toLowerCase()
          .includes(text) ||
        (customer.gst_number || "")
          .toLowerCase()
          .includes(text);

      const matchesPayment =
        filterPayment === "All" ||
        customer.payment_term === filterPayment;

      const matchesGST =
        filterGST === "All" ||
        (filterGST === "GST"
          ? customer.gst_available
          : !customer.gst_available);

      return (
        matchesSearch &&
        matchesPayment &&
        matchesGST
      );
    });
  }, [
    customers,
    search,
    filterPayment,
    filterGST,
  ]);

  const custCols = {
    customer_code: (c: any) => String(c.customer_code || ""),
    customer_name: (c: any) => String(c.customer_name || ""),
    mobile: (c: any) => String(c.mobile || ""),
    business_name: (c: any) => String(c.business_name || ""),
    payment_term: (c: any) => String(c.payment_term || ""),
    gst_available: (c: any) => (c.gst_available ? "Yes" : "No"),
    gst_number: (c: any) => String(c.gst_number || ""),
    address: (c: any) => String(c.address || ""),
  } as const;
  const { sort, sorted: sortedCustomers } = useSortedRows(filteredCustomers, custCols, "customer_code");

  // --------------------------------------------------
  // STATISTICS
  // --------------------------------------------------

  const gstCustomers = customers.filter(
    (customer) => customer.gst_available
  ).length;

  const creditCustomers = customers.filter(
    (customer) => customer.payment_term !== "Cash"
  ).length;

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="customers-page">

      {/* PAGE HEADER */}

      <div className="customers-page-header">

        <div>
          <div className="customers-title-row">
            <div className="customers-title-icon">
              👥
            </div>

            <div>
              <h1>Customer Master</h1>

              <p>
                Manage customers, GST and payment terms
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          {/* BULK CSV UPLOAD BUTTON */}
          <label 
            className="customer-primary-button" 
            style={{ cursor: "pointer", background: "#059669" }}
            title="Upload CSV for Bulk Customers"
          >
            <span>📁</span>
            {uploading ? "Uploading..." : "Upload CSV"}
            <input 
              type="file" 
              accept=".csv" 
              onChange={handleBulkUpload} 
              style={{ display: "none" }} 
              disabled={uploading}
            />
          </label>

          <button
            className="customer-primary-button"
            onClick={openAddForm}
          >
            <span>＋</span>
            Add Customer
          </button>
        </div>

      </div>

      {/* STAT CARDS */}

      <div className="customer-stat-grid">

        <div className="customer-stat-card">
          <div className="customer-stat-icon">
            👥
          </div>

          <div>
            <span>Total Customers</span>
            <strong>{customers.length}</strong>
            <small>All customers</small>
          </div>
        </div>

        <div className="customer-stat-card">
          <div className="customer-stat-icon gst">
            ✓
          </div>

          <div>
            <span>GST Customers</span>
            <strong>{gstCustomers}</strong>
            <small>GST registered</small>
          </div>
        </div>

        <div className="customer-stat-card">
          <div className="customer-stat-icon credit">
            ₹
          </div>

          <div>
            <span>Credit Customers</span>
            <strong>{creditCustomers}</strong>
            <small>Non-cash payment</small>
          </div>
        </div>

        <div className="customer-stat-card">
          <div className="customer-stat-icon active">
            ✓
          </div>

          <div>
            <span>Active Records</span>
            <strong>{customers.length}</strong>
            <small>Currently available</small>
          </div>
        </div>

      </div>

      {/* CUSTOMER TABLE CARD */}

      <div className="customers-table-card">

        <div className="customers-toolbar">

          <div>
            <h2>Customer List</h2>

            <p>
              Showing{" "}
              <strong>
                {filteredCustomers.length}
              </strong>{" "}
              of {customers.length} customers
            </p>
          </div>

          <div className="customer-toolbar-actions">

            <div className="customer-search">
              <span>⌕</span>

              <input
                type="text"
                placeholder="Search customer, mobile, GST..."
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
              />
            </div>

            <select
              className="customer-filter"
              value={filterPayment}
              onChange={(event) =>
                setFilterPayment(event.target.value)
              }
            >
              <option value="All">
                All Payment Terms
              </option>

              {paymentTerms.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>

            <select
              className="customer-filter"
              value={filterGST}
              onChange={(event) =>
                setFilterGST(event.target.value)
              }
            >
              <option value="All">All GST</option>
              <option value="GST">GST Available</option>
              <option value="Non-GST">Non GST</option>
            </select>

          </div>

        </div>

        {/* TABLE */}

        {loading ? (

          <div className="customer-loading">
            <div className="loading-spinner"></div>
            <span>Loading customers...</span>
          </div>

        ) : (

          <div className="customer-table-wrapper">

            <table className="customer-table">

              <thead>
                <tr>
                  <SortTh label="CODE" active={sort.key === "customer_code"} dir={sort.dir} onToggle={() => sort.toggle("customer_code")} />
                  <SortTh label="CUSTOMER" active={sort.key === "customer_name"} dir={sort.dir} onToggle={() => sort.toggle("customer_name")} />
                  <SortTh label="MOBILE" active={sort.key === "mobile"} dir={sort.dir} onToggle={() => sort.toggle("mobile")} />
                  <SortTh label="BUSINESS" active={sort.key === "business_name"} dir={sort.dir} onToggle={() => sort.toggle("business_name")} />
                  <SortTh label="PAYMENT" active={sort.key === "payment_term"} dir={sort.dir} onToggle={() => sort.toggle("payment_term")} />
                  <SortTh label="GST" active={sort.key === "gst_available"} dir={sort.dir} onToggle={() => sort.toggle("gst_available")} />
                  <SortTh label="GST NUMBER" active={sort.key === "gst_number"} dir={sort.dir} onToggle={() => sort.toggle("gst_number")} />
                  <SortTh label="ADDRESS" active={sort.key === "address"} dir={sort.dir} onToggle={() => sort.toggle("address")} />
                  <th>ACTION</th>
                </tr>
              </thead>

              <tbody>

                {filteredCustomers.length === 0 ? (

                  <tr>
                    <td colSpan={9}>

                      <div className="customer-empty">

                        <div className="customer-empty-icon">
                          👥
                        </div>

                        <h3>
                          No customers found
                        </h3>

                        <p>
                          Add your first customer
                          to get started.
                        </p>

                        <button
                          className="customer-empty-button"
                          onClick={openAddForm}
                        >
                          ＋ Add Customer
                        </button>

                      </div>

                    </td>
                  </tr>

                ) : (

                  sortedCustomers.map((customer) => (

                    <tr key={customer.id}>

                      {/* CODE */}

                      <td>
                        <span className="customer-code-badge">
                          C
                          {String(
                            customer.customer_code || 0
                          ).padStart(4, "0")}
                        </span>
                      </td>

                      {/* CUSTOMER */}

                      <td>
                        <div className="customer-name-cell">

                          <div className="customer-avatar">
                            {(customer.customer_name ||
                              "C")
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <div>
                            <strong>
                              {customer.customer_name ||
                                "-"}
                            </strong>

                            <span>
                              Customer
                            </span>
                          </div>

                        </div>
                      </td>

                      {/* MOBILE */}

                      <td>
                        <span className="mobile-text">
                          {customer.mobile || "-"}
                        </span>
                      </td>

                      {/* BUSINESS */}

                      <td>
                        <div className="business-cell">
                          {customer.business_name ||
                            "-"}
                        </div>
                      </td>

                      {/* PAYMENT */}

                      <td>
                        <span className="payment-badge">
                          {customer.payment_term ||
                            "Cash"}
                        </span>
                      </td>

                      {/* GST */}

                      <td>
                        {customer.gst_available ? (
                          <span className="status-badge gst-yes">
                            ✓ GST
                          </span>
                        ) : (
                          <span className="status-badge gst-no">
                            Non-GST
                          </span>
                        )}
                      </td>

                      {/* GST NUMBER */}

                      <td>
                        <span className="gst-number">
                          {customer.gst_number ||
                            "—"}
                        </span>
                      </td>

                      {/* ADDRESS */}

                      <td>
                        <div
                          className="address-cell"
                          title={
                            customer.business_address ||
                            ""
                          }
                        >
                          {customer.business_address ||
                            "—"}
                        </div>
                      </td>

                      {/* ACTION */}

                      <td>

                        <div className="customer-actions">

                          <button
                            className="table-action view"
                            title="View Customer Details"
                            onClick={() =>
                              setViewingCustomer(customer)
                            }
                          >
                            View
                          </button>

                          <button
                            className="table-action edit"
                            title="Edit Customer"
                            onClick={() =>
                              openEditForm(customer)
                            }
                          >
                            ✎
                          </button>

                          <button
                            className="table-action delete"
                            title="Delete Customer"
                            onClick={() =>
                              handleDelete(
                                customer.id
                              )
                            }
                          >
                            🗑
                          </button>

                        </div>

                      </td>

                    </tr>

                  ))

                )}

              </tbody>

            </table>

          </div>

        )}

      </div>

      {/* ADD / EDIT MODAL */}

      {showForm && (

        <div
          className="customer-modal-overlay"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget
            ) {
              resetForm();
              setShowForm(false);
            }
          }}
        >

          <div className="customer-modal">

            {/* MODAL HEADER */}

            <div className="customer-modal-header">

              <div className="modal-title-section">

                <div className="modal-icon">
                  {editingCustomer
                    ? "✎"
                    : "＋"}
                </div>

                <div>
                  <h2>
                    {editingCustomer
                      ? "Edit Customer"
                      : "Add New Customer"}
                  </h2>

                  <p>
                    {editingCustomer
                      ? "Update customer information"
                      : "Enter customer information"}
                  </p>
                </div>

              </div>

              <button
                className="modal-close"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
              >
                ×
              </button>

            </div>

            {/* CUSTOMER CODE */}

            {editingCustomer && (
              <div className="editing-code">
                Customer Code:
                <strong>
                  C
                  {String(
                    editingCustomer.customer_code ||
                      0
                  ).padStart(4, "0")}
                </strong>
              </div>
            )}

            {/* FORM */}

            <form onSubmit={handleSave}>

              <div className="customer-form-grid">

                {/* CUSTOMER NAME */}

                <div className="customer-form-group">
                  <label>
                    Customer Name
                    <span>*</span>
                  </label>

                  <input
                    type="text"
                    value={customerName}
                    onChange={(event) =>
                      setCustomerName(
                        event.target.value
                      )
                    }
                    placeholder="Enter customer name"
                    autoFocus
                  />
                </div>

                {/* MOBILE */}

                <div className="customer-form-group">
                  <label>
                    Mobile Number
                  </label>

                  <input
                    type="text"
                    value={mobile}
                    onChange={(event) =>
                      setMobile(
                        event.target.value
                      )
                    }
                    placeholder="Enter mobile number"
                    maxLength={15}
                  />
                </div>

                {/* BUSINESS NAME */}

                <div className="customer-form-group">
                  <label>
                    Business Name
                  </label>

                  <input
                    type="text"
                    value={businessName}
                    onChange={(event) =>
                      setBusinessName(
                        event.target.value
                      )
                    }
                    placeholder="Enter business name"
                  />
                </div>

                {/* PAYMENT TERM */}

                <div className="customer-form-group">
                  <label>
                    Payment Term
                  </label>

                  <select
                    value={paymentTerm}
                    onChange={(event) =>
                      setPaymentTerm(
                        event.target.value
                      )
                    }
                  >
                    {paymentTerms.map((term) => (
                      <option
                        key={term}
                        value={term}
                      >
                        {term}
                      </option>
                    ))}
                  </select>
                </div>

                {/* GST */}

                <div className="customer-form-group">
                  <label>
                    GST Available
                  </label>

                  <select
                    value={
                      gstAvailable
                        ? "Yes"
                        : "No"
                    }
                    onChange={(event) => {
                      const value =
                        event.target.value ===
                        "Yes";

                      setGstAvailable(value);

                      if (!value) {
                        setGstNumber("");
                      }
                    }}
                  >
                    <option value="No">
                      No
                    </option>

                    <option value="Yes">
                      Yes
                    </option>
                  </select>
                </div>

                {/* GST NUMBER */}

                <div className="customer-form-group">

                  <label>
                    GST Number
                    {gstAvailable && (
                      <span>*</span>
                    )}
                  </label>

                  <input
                    type="text"
                    value={gstNumber}
                    onChange={(event) =>
                      setGstNumber(
                        event.target.value.toUpperCase()
                      )
                    }
                    placeholder={
                      gstAvailable
                        ? "Enter GST number"
                        : "Not applicable"
                    }
                    disabled={!gstAvailable}
                    maxLength={15}
                  />

                </div>

                {/* ADDRESS */}

                <div className="customer-form-group full">

                  <label>
                    Business Address
                  </label>

                  <textarea
                    value={businessAddress}
                    onChange={(event) =>
                      setBusinessAddress(
                        event.target.value
                      )
                    }
                    placeholder="Enter complete business address"
                    rows={4}
                  />

                </div>

              </div>

              {/* FORM FOOTER */}

              <div className="customer-modal-footer">

                <button
                  type="button"
                  className="modal-cancel-button"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="modal-save-button"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingCustomer
                    ? "Update Customer"
                    : "Save Customer"}
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

      {viewingCustomer && (
        <CustomerDetails
          customer={viewingCustomer}
          onClose={() => setViewingCustomer(null)}
        />
      )}

    </div>
  );
}

export default Customers; 