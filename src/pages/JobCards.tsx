import { sc } from "../lib/company";
import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "../lib/formatDate";
import { SortTh, useSortedRows } from "../lib/tableSort";

type Customer = {
  id: number;
  customer_code: number | string | null;
  customer_name: string | null;
  mobile: string | null;
  business_name: string | null;
  business_address: string | null;
};

type Technician = {
  id: number;
  name: string;
  mobile?: string;
  share_percent?: number | null;
};

type Assignment = {
  technician_id: number;
  technician_name: string;
};

type JobCard = {
  id: number;
  job_no: string | null;
  job_date: string | null;
  customer_id: number | null;

  customer_code?: string | number | null;
  customer_name?: string | null;
  business_name: string | null;
  mobile?: string | null;
  address?: string | null;

  received_quantity: number | null;

  service_type: string | null;
  technician: string | null;

  repairing_quantity: number | null;
  warranty_quantity: number | null;
  reject_quantity: number | null;

  remarks: string | null;

  module_image_url?: string | null;
  received_image_url?: string | null;

  status: string | null;
  closed_at?: string | null;
  invoice_id?: number | null;

  created_at?: string | null;
};

type FormState = {
  job_date: string;
  customer_id: string;

  repairing_quantity: string;
  warranty_quantity: string;
  reject_quantity: string;

  service_type: string;
  technician: string;

  remarks: string;

  module_image_url: string;
};

const SERVICE_TYPES = [
  "Standard Service - 3 Month Warranty",
  "Premium Service - 1 Year Warranty",
];

const today = () => {
  const d = new Date();

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const numberValue = (
  value: string | number | null | undefined
) => {
  const n = Number(value || 0);

  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }

  return Math.floor(n);
};

const customerCode = (
  value: number | string | null | undefined
) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "-";
  }

  const text = String(value);

  if (text.startsWith("C")) {
    return text;
  }

  return `C${text.padStart(4, "0")}`;
};

const jobNumber = (
  jobNo: string | null | undefined,
  id?: number
) => {
  const safeJobNo = String(jobNo || "").trim();

  if (safeJobNo) {
    return safeJobNo;
  }

  if (id) {
    return `JC-${String(id).padStart(5, "0")}`;
  }

  return "Automatic";
};

const initialForm = (): FormState => ({
  job_date: today(),
  customer_id: "",

  repairing_quantity: "",
  warranty_quantity: "",
  reject_quantity: "",

  service_type: SERVICE_TYPES[0],
  technician: "",

  remarks: "Received for repair",

  module_image_url: "",
});

function JobCards({ technicianScopeId }: { technicianScopeId?: number | null } = {}) {
  const [customers, setCustomers] = useState<Customer[]>(() => {
    const cached = localStorage.getItem("cache_customers");
    return cached ? JSON.parse(cached) : [];
  });

  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [assignments, setAssignments] = useState<Record<number, Assignment[]>>({});
  // Technician Master / share_percent load fail ho to dikhane wala message.
  const [technicianError, setTechnicianError] = useState("");
  // Form me tick hue technicians ke ids (multi-select).
  const [selectedTechIds, setSelectedTechIds] = useState<number[]>([]);

  const [jobs, setJobs] = useState<JobCard[]>(() => {
    const cached = localStorage.getItem("cache_job_cards");
    return cached ? JSON.parse(cached) : [];
  });

  const [loading, setLoading] = useState(jobs.length === 0);
  const [saving, setSaving] = useState(false);

  const [schemaError, setSchemaError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);

  const [editing, setEditing] =
    useState<JobCard | null>(null);

  const [viewing, setViewing] =
    useState<JobCard | null>(null);

  const [viewImage, setViewImage] =
    useState<string | null>(null);

  const [form, setForm] =
    useState<FormState>(initialForm());

  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] =
    useState("All");

  const [statusFilter, setStatusFilter] =
    useState("All");

  const [dateFilter, setDateFilter] =
    useState("");

  // =====================================================
  // LOAD DATA WITH INSTANT CACHING
  // =====================================================

  const loadData = async () => {
    if (jobs.length === 0) setLoading(true);

    const customersResult = await sc("customers")
      .select(
        `
        id,
        customer_code,
        customer_name,
        mobile,
        business_name,
        business_address
        `
      )
      .order("business_name", {
        ascending: true,
      });

    const techniciansResult = await sc("technicians")
      .select("id, name, mobile, share_percent")
      .order("name", { ascending: true });

    const jobsResult = await sc("job_cards")
      .select(
        `
        id,
        job_no,
        job_date,
        customer_id,
        business_name,
        received_quantity,
        service_type,
        technician,
        repairing_quantity,
        warranty_quantity,
        reject_quantity,
        remarks,
        status,
        closed_at,
        invoice_id,
        created_at
        `
      )
      .order("id", {
        ascending: false,
      });

    if (customersResult.error) {
      console.error(customersResult.error);
      setSchemaError(
        `Customer data load nahi hua: ${customersResult.error.message}`
      );
    } else {
      const cList = (customersResult.data || []) as Customer[];
      setCustomers(cList);
      localStorage.setItem("cache_customers", JSON.stringify(cList));
    }

    if (techniciansResult.error) {
      // Usually `share_percent` column abhi banaya hi nahi gaya hoga — is case
      // me technician tick karna possible nahi, isliye saaf message dikhao.
      console.error("Technicians load error:", techniciansResult.error);
      setTechnicianError(techniciansResult.error.message);
    } else {
      setTechnicians((techniciansResult.data || []) as Technician[]);
      setTechnicianError("");
    }

        if (jobsResult.error) {
      console.error(jobsResult.error);
      setSchemaError(
        `Job Card data load nahi hua: ${jobsResult.error.message}`
      );
      setJobs([]);
    } else {
      const jList = (jobsResult.data || []) as JobCard[];
      setJobs(jList);
      localStorage.setItem("cache_job_cards", JSON.stringify(jList));
      setSchemaError("");
    }

    // Salary report ke liye: kis job card par kaun kaam kiya. Migration ke baad
    // ye table banti hai; migration na chalaya ho to job card phir bhi save ho
    // jayega bas salary me assignment nahi dikhegi.
    const assignResult = await sc("job_card_technicians")
      .select("job_card_id, technician_id, technician_name");

    if (assignResult.error) {
      console.warn("job_card_technicians load nahi hua (migration chahiye?):", assignResult.error.message);
      setAssignments({});
    } else {
      const grouped: Record<number, Assignment[]> = {};
      (assignResult.data || []).forEach((row: any) => {
        const jobId = Number(row.job_card_id);
        if (!jobId) return;
        grouped[jobId] = grouped[jobId] || [];
        grouped[jobId].push({
          technician_id: Number(row.technician_id),
          technician_name: String(row.technician_name || ""),
        });
      });
      setAssignments(grouped);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // =====================================================
  // FORM UPDATE
  // =====================================================

  const updateForm = (
    key: keyof FormState,
    value: string
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  // =====================================================
  // SELECTED CUSTOMER
  // =====================================================

  const selectedCustomer = customers.find(
    (customer) =>
      customer.id === Number(form.customer_id)
  );

  // =====================================================
  // QUANTITY
  // =====================================================

  const repairingQty = numberValue(
    form.repairing_quantity
  );

  const warrantyQty = numberValue(
    form.warranty_quantity
  );

  const rejectQty = numberValue(
    form.reject_quantity
  );

  const totalReceived =
    repairingQty +
    warrantyQty +
    rejectQty;

  // =====================================================
  // JOB NUMBER
  // =====================================================

  const generateJobNumber = async () => {
    const { data, error } = await sc("job_cards")
      .select("job_no")
      .not("job_no", "is", null);

    if (error) {
      console.error(error);
      return `JC-${new Date().getFullYear()}-00001`;
    }

    let highest = 0;

    (data || []).forEach((item) => {
      const value = String(
        item.job_no || ""
      );

      const match = value.match(/(\d+)$/);

      if (match) {
        const n = Number(match[1]);

        if (n > highest) {
          highest = n;
        }
      }
    });

    return `JC-${new Date().getFullYear()}-${String(
      highest + 1
    ).padStart(5, "0")}`;
  };

  // =====================================================
  // NEW JOB CARD
  // =====================================================

  const openNew = () => {
    setEditing(null);
    setViewing(null);

    setForm(initialForm());

    // Default: sabhi share-bearing workers tick. Jis din koi chutti par ho,
    // usko untick kar dijiye — uska salary share automatically 0 ho jayega.
    setSelectedTechIds(
      technicians
        .filter((t) => Number(t.share_percent || 0) > 0)
        .map((t) => t.id)
    );

    setShowForm(true);
  };

  // =====================================================
  // EDIT JOB CARD
  // =====================================================

  const openEdit = async (job: JobCard) => {
    setEditing(job);

    let imageUrl = "";

    const { data } = await sc("job_cards")
      .select("module_image_url, received_image_url")
      .eq("id", job.id)
      .single();

    if (data) {
      imageUrl = data.module_image_url || data.received_image_url || "";
    }

    setForm({
      job_date:
        job.job_date || today(),

      customer_id:
        String(job.customer_id || ""),

      repairing_quantity:
        String(
          numberValue(
            job.repairing_quantity
          )
        ),

      warranty_quantity:
        String(
          numberValue(
            job.warranty_quantity
          )
        ),

      reject_quantity:
        String(
          numberValue(
            job.reject_quantity
          )
        ),

      service_type:
        job.service_type ||
        SERVICE_TYPES[0],

      technician:
        job.technician || "",

      remarks:
        job.remarks ||
        "Received for repair",

      module_image_url: imageUrl,
    });

    // Salary report ke liye tick marks bhari karo. Purane job cards me assignment
    // table migration ke baad backfill ho jayegi; tab tak text column se bhi
    // naam mil jate hain (ek hi worker ho to uska naam use kar lo).
    const saved = assignments[job.id];
    if (saved && saved.length) {
      setSelectedTechIds(saved.map((a) => a.technician_id));
    } else if (job.technician) {
      const match = technicians.filter((t) =>
        String(job.technician || "")
          .toLowerCase()
          .split(",")
          .map((n) => n.trim())
          .includes(String(t.name || "").toLowerCase())
      );
      setSelectedTechIds(match.length ? match.map((t) => t.id) : []);
    } else {
      setSelectedTechIds([]);
    }

    setShowForm(true);
  };

  // =====================================================
  // IMAGE
  // =====================================================

  const handleImage = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert(
        "Please select an image file."
      );

      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      alert(
        "Image maximum 5 MB ki honi chahiye."
      );

      return;
    }

    const reader =
      new FileReader();

    reader.onload = () => {
      if (
        typeof reader.result ===
        "string"
      ) {
        updateForm(
          "module_image_url",
          reader.result
        );
      }
    };

    reader.readAsDataURL(file);
  };

  // =====================================================
  // SAVE JOB CARD
  // =====================================================

  const saveJob = async (
    event: React.FormEvent
  ) => {
    event.preventDefault();

    if (!form.customer_id) {
      alert(
        "Please select customer."
      );

      return;
    }

    if (!selectedCustomer) {
      alert(
        "Selected customer nahi mila."
      );

      return;
    }

    if (selectedTechIds.length === 0) {
      alert(
        "Please select at least one technician (जिसने काम किया उसे tick करें)."
      );

      return;
    }

    if (totalReceived <= 0) {
      alert(
        "Repairing, Warranty ya Reject quantity enter karein."
      );

      return;
    }

    if (
      repairingQty < 0 ||
      warrantyQty < 0 ||
      rejectQty < 0
    ) {
      alert(
        "Quantity negative nahi ho sakti."
      );

      return;
    }

    setSaving(true);

    // Tick hue technicians ke naam — text column aur assignment dono ke liye.
    const selectedTechNames = technicians
      .filter((t) => selectedTechIds.includes(t.id))
      .map((t) => String(t.name || "").trim())
      .filter(Boolean);

    let jobNo =
      editing?.job_no || "";

    if (!editing) {
      jobNo =
        await generateJobNumber();
    }

    const payload = {
      job_no: jobNo,

      job_date:
        form.job_date || today(),

      customer_id:
        selectedCustomer.id,

      business_name:
        selectedCustomer.business_name ||
        null,

      received_quantity:
        totalReceived,

      repairing_quantity:
        repairingQty,

      warranty_quantity:
        warrantyQty,

      reject_quantity:
        rejectQty,

      service_type:
        form.service_type,

      // Text column abhi bhi bharta rahe (purane reports/sorting iske hi basis
      // par chalte hain), par asli salary assignment `job_card_technicians` me.
      technician:
        selectedTechNames.join(", ") ||
        null,

      remarks:
        form.remarks.trim() ||
        null,

      module_image_url:
        form.module_image_url ||
        null,

      status:
        editing?.status ||
        "Open",
    };

    let result: any;

    if (editing) {
      result = await sc("job_cards")
        .update(payload)
        .eq(
          "id",
          editing.id
        );
    } else {
      result = await sc("job_cards")
        .insert(payload);
    }

    setSaving(false);

    if (result.error) {
      console.error(result.error);

      alert(
        `Job Card save nahi hua.\n\n${result.error.message}`
      );

      return;
    }

    // ---- Technician assignment (salary report ke liye) ----
    // Pehle se assignment table nahi ho (migration nahi chala) to sirf warn
    // karke aage badh jaate hain — job card save ho jayega.
    const savedJobId = editing
      ? editing.id
      : result.data?.[0]?.id;

    if (savedJobId) {
      const rows = selectedTechNames.map((name, index) => ({
        job_card_id: savedJobId,
        technician_id: selectedTechIds[index],
        technician_name: name,
      }));

      const assignResult = await sc("job_card_technicians")
        .delete()
        .eq("job_card_id", savedJobId);

      if (assignResult.error) {
        console.warn(
          "Technician assignment save nahi hua:",
          assignResult.error.message
        );
      } else if (rows.length) {
        const insertResult = await sc("job_card_technicians")
          .insert(rows);

        if (insertResult.error) {
          console.warn(
            "Technician assignment save nahi hua:",
            insertResult.error.message
          );
        }
      }
    }

    setShowForm(false);
    setEditing(null);
    setForm(initialForm());
    setSelectedTechIds([]);

    await loadData();

    alert(
      editing
        ? "Job Card successfully updated."
        : "Job Card successfully created."
    );
  };

  // =====================================================
  // DELETE
  // =====================================================

  const deleteJob = async (
    job: JobCard
  ) => {
    if (
      (job.status || "").toLowerCase() ===
      "closed"
    ) {
      alert(
        "Closed Job Card delete nahi kiya ja sakta."
      );

      return;
    }

    const confirmed =
      window.confirm(
        `${jobNumber(
          job.job_no,
          job.id
        )} delete karein?`
      );

    if (!confirmed) {
      return;
    }

    const { error } =
      await sc("job_cards")
        .delete()
        .eq(
          "id",
          job.id
        );

    if (error) {
      alert(
        `Job Card delete nahi hua.\n\n${error.message}`
      );

      return;
    }

    await loadData();
  };

  // =====================================================
  // FILTER
  // =====================================================

  const filteredJobs =
    useMemo(() => {
      // Technician role: sirf apne assign kiye hue job cards dikhenge.
      // technicianScopeId undefined = non-technician user (sab dikhenge).
      const scopedJobs =
        technicianScopeId === undefined
          ? jobs
          : jobs.filter((job) => {
              if (!technicianScopeId) return false;
              const assigned = (assignments[job.id] || []).some(
                (a) => Number(a.technician_id) === Number(technicianScopeId)
              );
              if (assigned) return true;
              // Purane cards me technician sirf text column me likha hota tha.
              const tech = technicians.find((t) => Number(t.id) === Number(technicianScopeId));
              const legacy = String(job.technician || "").trim();
              if (!tech?.name || !legacy) return false;
              return legacy
                .split(",")
                .map((n) => n.trim().toLowerCase())
                .includes(String(tech.name).trim().toLowerCase());
            });

      return scopedJobs.filter(
        (job) => {
          const term =
            search
              .trim()
              .toLowerCase();

          const customer =
            customers.find(
              (item) =>
                item.id ===
                job.customer_id
            );

          const number =
            jobNumber(
              job.job_no,
              job.id
            );

          const customerName =
            customer?.customer_name ||
            "";

          const businessName =
            job.business_name ||
            customer?.business_name ||
            "";

          const mobile =
            customer?.mobile ||
            "";

          const matchesSearch =
            !term ||
            String(number)
              .toLowerCase()
              .includes(term) ||
            customerName
              .toLowerCase()
              .includes(term) ||
            businessName
              .toLowerCase()
              .includes(term) ||
            mobile
              .toLowerCase()
              .includes(term);

          const matchesCustomer =
            customerFilter ===
              "All" ||
            String(
              job.customer_id
            ) ===
              customerFilter;

          const matchesStatus =
            statusFilter ===
              "All" ||
            (job.status ||
              "Open") ===
              statusFilter;

          const matchesDate =
            !dateFilter ||
            job.job_date ===
              dateFilter;

          return (
            matchesSearch &&
            matchesCustomer &&
            matchesStatus &&
            matchesDate
          );
        }
      );
    }, [
      jobs,
      customers,
      search,
      customerFilter,
      statusFilter,
      dateFilter,
      technicianScopeId,
      assignments,
      technicians,
    ]);

  const jobCols = {
    job_no: (j: any) => String(j.job_no || j.id || ""),
    job_date: (j: any) => String(j.job_date || ""),
    customer_name: (j: any) => {
      const c = customers.find((item: any) => item.id === j.customer_id);
      return String(c?.customer_name || "");
    },
    business_name: (j: any) =>
      String(
        j.business_name ||
          customers.find((item: any) => item.id === j.customer_id)
            ?.business_name ||
          ""
      ),
    repairing_quantity: (j: any) => Number(j.repairing_quantity || 0),
    warranty_quantity: (j: any) => Number(j.warranty_quantity || 0),
    reject_quantity: (j: any) => Number(j.reject_quantity || 0),
    technician: (j: any) => String(j.technician || ""),
    service_type: (j: any) => String(j.service_type || ""),
    status: (j: any) => String(j.status || ""),
  } as const;
  const { sort, sorted: sortedJobs } = useSortedRows(
    filteredJobs,
    jobCols,
    "job_date",
    "desc"
  );

  // =====================================================
  // SUMMARY
  // =====================================================

  const summary =
    useMemo(() => {
      const received =
        jobs.reduce(
          (sum, job) =>
            sum +
            numberValue(
              job.received_quantity
            ),
          0
        );

      const repaired =
        jobs.reduce(
          (sum, job) =>
            sum +
            numberValue(
              job.repairing_quantity
            ),
          0
        );

      const warranty =
        jobs.reduce(
          (sum, job) =>
            sum +
            numberValue(
              job.warranty_quantity
            ),
          0
        );

      const pending =
        jobs.filter(
          (job) =>
            (job.status ||
              "Open") !==
            "Closed"
        ).length;

      return {
        total: jobs.length,
        received,
        repaired,
        warranty,
        pending,
      };
    }, [jobs]);

  // =====================================================
  // STATUS STYLE
  // =====================================================

  const statusStyle = (
    status: string | null
  ) => {
    const safe =
      status || "Open";

    if (
      safe.toLowerCase() ===
      "closed"
    ) {
      return {
        background: "#dcfce7",
        color: "#166534",
      };
    }

    return {
      background: "#dbeafe",
      color: "#1d4ed8",
    };
  };

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <div
      style={{
        width: "100%",
      }}
    >
      {/* =================================================
          HEADER
      ================================================. */}

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "center",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background:
                  "linear-gradient(135deg,#2563eb,#4f46e5)",
                display: "flex",
                alignItems: "center",
                justifyContent:
                  "center",
                fontSize: 23,
                boxShadow:
                  "0 8px 20px rgba(37,99,235,.20)",
              }}
            >
              🔧
            </div>

            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 26,
                  fontWeight: 800,
                  color: "#0f172a",
                }}
              >
                Module Repair / Job Card
              </h1>

              <p
                style={{
                  margin:
                    "5px 0 0",
                  color: "#64748b",
                  fontSize: 14,
                }}
              >
                Manage module receiving
                and repair jobs
              </p>
            </div>
          </div>
        </div>

        {technicianScopeId === undefined && (
          <button
            className="customer-primary-button"
            onClick={openNew}
            disabled={Boolean(
              schemaError
            )}
          >
            ＋ New Job Card
          </button>
        )}
      </div>

      {/* =================================================
          ERROR
      ================================================ */}

      {schemaError && (
        <div
          style={{
            background: "#fff7ed",
            border:
              "1px solid #fed7aa",
            color: "#9a3412",
            borderRadius: 14,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <strong>
            Job Card Database Error
          </strong>

          <div
            style={{
              marginTop: 5,
            }}
          >
            {schemaError}
          </div>
        </div>
      )}

      {/* =================================================
          SUMMARY
      ================================================ */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(180px,1fr))",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <SummaryCard
          title="Total Jobs"
          value={summary.total}
          subtitle="All Job Cards"
          icon="📋"
          background="#eff6ff"
        />

        <SummaryCard
          title="Received Modules"
          value={summary.received.toLocaleString(
            "en-IN"
          )}
          subtitle="Total Quantity"
          icon="📦"
          background="#fff7ed"
        />

        <SummaryCard
          title="Repairing Modules"
          value={summary.repaired.toLocaleString(
            "en-IN"
          )}
          subtitle="Repairing Quantity"
          icon="✓"
          background="#f0fdf4"
        />

        <SummaryCard
          title="Warranty Modules"
          value={summary.warranty.toLocaleString(
            "en-IN"
          )}
          subtitle="Warranty Quantity"
          icon="🛡"
          background="#dbeafe"
        />

        <SummaryCard
          title="Pending Jobs"
          value={summary.pending}
          subtitle="Invoice Pending"
          icon="⏳"
          background="#faf5ff"
        />
      </div>

      {/* =================================================
          TABLE CARD
      ================================================ */}

      <section
        style={{
          background: "#ffffff",
          border:
            "1px solid #e2e8f0",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow:
            "0 4px 18px rgba(15,23,42,.04)",
        }}
      >
        {/* TOOLBAR */}

        <div
          style={{
            padding: 18,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent:
              "space-between",
            borderBottom:
              "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              flex: "1 1 300px",
              maxWidth: 430,
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 14,
                top: 11,
                color: "#94a3b8",
              }}
            >
              🔎
            </span>

            <input
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Search Job Card, Customer or Business"
              style={{
                width: "100%",
                boxSizing:
                  "border-box",
                padding:
                  "11px 14px 11px 40px",
                border:
                  "1px solid #dbe3ef",
                borderRadius: 10,
                outline: "none",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <select
              value={customerFilter}
              onChange={(event) =>
                setCustomerFilter(
                  event.target.value
                )
              }
              style={filterStyle}
            >
              <option value="All">
                All Customers
              </option>

              {customers.map(
                (customer) => (
                  <option
                    key={
                      customer.id
                    }
                    value={
                      customer.id
                    }
                  >
                    {customerCode(
                      customer.customer_code
                    )}{" "}
                    —{" "}
                    {customer.customer_name ||
                      "-"}
                  </option>
                )
              )}
            </select>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value
                )
              }
              style={filterStyle}
            >
              <option value="All">
                All Status
              </option>

              <option value="Open">
                Open
              </option>

              <option value="Closed">
                Closed
              </option>
            </select>

            <input
              type="date"
              value={dateFilter}
              onChange={(event) =>
                setDateFilter(
                  event.target.value
                )
              }
              style={filterStyle}
            />
          </div>
        </div>

        {/* Technician scope notice — sirf apne job cards */}
        {technicianScopeId !== undefined && (
          <div
            style={{
              margin: "0 0 14px",
              padding: "10px 14px",
              background: technicianScopeId ? "#eff6ff" : "#fef2f2",
              border: `1px solid ${technicianScopeId ? "#bfdbfe" : "#fecaca"}`,
              borderRadius: 8,
              color: technicianScopeId ? "#1d4ed8" : "#b91c1c",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {technicianScopeId
              ? "🔒 Sirf aapko assign kiye gaye job cards dikh rahe hain."
              : "🔒 Aapki Technician link abhi assign nahi hui — Admin ko 'Users & Roles' me apna Technician link karne ko kahein."}
          </div>
        )}

        {/* TABLE */}

        {loading ? (
          <div
            style={{
              padding: 70,
              textAlign: "center",
              color: "#64748b",
            }}
          >
            <div
              style={{
                fontSize: 32,
                marginBottom: 10,
              }}
            >
              ⏳
            </div>

            Loading Job Cards...
          </div>
        ) : filteredJobs.length ===
          0 ? (
          <div
            style={{
              padding: 70,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 42,
              }}
            >
              🔧
            </div>

            <h3
              style={{
                margin:
                  "12px 0 5px",
              }}
            >
              No Job Cards Found
            </h3>

            <p
              style={{
                color: "#64748b",
                marginBottom: 20,
              }}
            >
              {technicianScopeId === undefined
                ? "Create your first Job Card."
                : "Aapko abhi tak koi Job Card assign nahi hua hai."}
            </p>

            {technicianScopeId === undefined && (
              <button
                className="customer-primary-button"
                onClick={openNew}
              >
                ＋ New Job Card
              </button>
            )}
          </div>
        ) : (
          <div
            style={{
              overflowX: "auto",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse:
                  "collapse",
                minWidth: 1050,
              }}
            >
              <thead>
                <tr
                  style={{
                    background:
                      "#f8fafc",
                  }}
                >
                  <SortTh label="Job Card" active={sort.key === "job_no"} dir={sort.dir} onToggle={() => sort.toggle("job_no")} style={thStyle} />

                  <SortTh label="Date" active={sort.key === "job_date"} dir={sort.dir} onToggle={() => sort.toggle("job_date")} style={thStyle} />

                  <SortTh label="Customer" active={sort.key === "customer_name"} dir={sort.dir} onToggle={() => sort.toggle("customer_name")} style={thStyle} />

                  <SortTh label="Business Name" active={sort.key === "business_name"} dir={sort.dir} onToggle={() => sort.toggle("business_name")} style={thStyle} />

                  <SortTh label="Repairing" active={sort.key === "repairing_quantity"} dir={sort.dir} onToggle={() => sort.toggle("repairing_quantity")} style={thStyle} align="right" />

                  <SortTh label="Warranty" active={sort.key === "warranty_quantity"} dir={sort.dir} onToggle={() => sort.toggle("warranty_quantity")} style={thStyle} align="right" />

                  <SortTh label="Reject" active={sort.key === "reject_quantity"} dir={sort.dir} onToggle={() => sort.toggle("reject_quantity")} style={thStyle} align="right" />

                  <SortTh label="Technician" active={sort.key === "technician"} dir={sort.dir} onToggle={() => sort.toggle("technician")} style={thStyle} />

                  <SortTh label="Service" active={sort.key === "service_type"} dir={sort.dir} onToggle={() => sort.toggle("service_type")} style={thStyle} />

                  <SortTh label="Status" active={sort.key === "status"} dir={sort.dir} onToggle={() => sort.toggle("status")} style={thStyle} />

                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>

              <tbody>
                {sortedJobs.map(
                  (job) => {
                    const customer =
                      customers.find(
                        (item) =>
                          item.id ===
                          job.customer_id
                      );

                    const service =
                      String(
                        job.service_type ||
                          ""
                      );

                    return (
                      <tr
                        key={
                          job.id
                        }
                      >
                        <td
                          style={
                            tdStyle
                          }
                        >
                          <strong
                            style={{
                              color:
                                "#2563eb",
                            }}
                          >
                            {jobNumber(
                              job.job_no,
                              job.id
                            )}
                          </strong>
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          {fmtDate(job.job_date) || "-"}
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          <strong>
                            {customer?.customer_name ||
                              "-"}
                          </strong>

                          <small
                            style={{
                              display:
                                "block",
                              color:
                                "#64748b",
                              marginTop: 3,
                            }}
                          >
                            {customerCode(
                              customer?.customer_code
                            )}
                          </small>
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          {job.business_name ||
                            customer?.business_name ||
                            "-"}
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          <strong>
                            {numberValue(
                              job.repairing_quantity
                            )}
                          </strong>
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          <strong>
                            {numberValue(
                              job.warranty_quantity
                            )}
                          </strong>
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          <strong>
                            {numberValue(
                              job.reject_quantity
                            )}
                          </strong>
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          {job.technician ||
                            "-"}
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              padding:
                                "5px 8px",
                              borderRadius:
                                7,
                              background:
                                service.startsWith(
                                  "Premium"
                                )
                                  ? "#f3e8ff"
                                  : "#eff6ff",
                              color:
                                service.startsWith(
                                  "Premium"
                                )
                                  ? "#7e22ce"
                                  : "#1d4ed8",
                            }}
                          >
                            {service.startsWith(
                              "Premium"
                            )
                              ? "Premium"
                              : "Standard"}
                          </span>
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          <span
                            style={{
                              ...statusStyle(
                                job.status
                              ),
                              display:
                                "inline-flex",
                              padding:
                                "5px 10px",
                              borderRadius:
                                20,
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {job.status ||
                              "Open"}
                          </span>
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          <div
                            style={{
                              display:
                                "flex",
                              gap: 6,
                            }}
                          >
                            <button
                              onClick={async () => {
                                setViewImage(null);
                                setViewing(job);
                                setShowView(true);
                                const { data } = await sc("job_cards")
                                  .select("module_image_url, received_image_url")
                                  .eq("id", job.id)
                                  .single();
                                if (data) {
                                  setViewImage(
                                    data.module_image_url || data.received_image_url || null
                                  );
                                }
                              }}
                              title="View"
                              style={
                                actionButton
                              }
                            >
                              👁
                            </button>

                            <button
                              onClick={() =>
                                openEdit(
                                  job
                                )
                              }
                              title="Edit"
                              style={
                                actionButton
                              }
                            >
                              ✏
                            </button>

                            <button
                              onClick={() =>
                                deleteJob(
                                  job
                                )
                              }
                              title="Delete"
                              style={{
                                ...actionButton,
                                color:
                                  "#dc2626",
                              }}
                            >
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* =================================================
          NEW / EDIT JOB CARD MODAL
      ================================================ */}

      {showForm && (
        <div
          style={overlayStyle}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowForm(
                false
              );
            }
          }}
        >
          <div
            style={modalStyle}
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            {/* MODAL HEADER */}

            <div
              style={{
                padding:
                  "22px 24px",
                borderBottom:
                  "1px solid #e2e8f0",
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
              }}
            >
              <div>
                <div
                  style={{
                    display:
                      "flex",
                    alignItems:
                      "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius:
                        10,
                      background:
                        "#eff6ff",
                      display:
                        "flex",
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                      fontSize: 19,
                    }}
                  >
                    🔧
                  </div>

                  <div>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 21,
                        color:
                          "#0f172a",
                      }}
                    >
                      {editing
                        ? "Edit Job Card"
                        : "New Job Card"}
                    </h2>

                    <p
                      style={{
                        margin:
                          "4px 0 0",
                        color:
                          "#64748b",
                        fontSize: 13,
                      }}
                    >
                      Module receiving
                      entry
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowForm(
                    false
                  )
                }
                style={{
                  width: 36,
                  height: 36,
                  border: "none",
                  borderRadius: 9,
                  background:
                    "#f1f5f9",
                  fontSize: 23,
                  cursor:
                    "pointer",
                  color:
                    "#475569",
                }}
              >
                ×
              </button>
            </div>

            {/* FORM */}

            <form
              onSubmit={saveJob}
            >
              <div
                style={{
                  padding: 24,
                  maxHeight:
                    "70vh",
                  overflowY:
                    "auto",
                }}
              >
                {/* JOB INFO */}

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 16,
                    marginBottom: 22,
                  }}
                >
                  <FormField label="Job Card Number">
                    <input
                      value={
                        editing
                          ? jobNumber(
                              editing.job_no,
                              editing.id
                            )
                          : "Automatic"
                      }
                      disabled
                      style={
                        inputStyle
                      }
                    />
                  </FormField>

                  <FormField
                    label="Date"
                    required
                  >
                    <input
                      type="date"
                      value={
                        form.job_date
                      }
                      onChange={(event) =>
                        updateForm(
                          "job_date",
                          event.target
                            .value
                        )
                      }
                      required
                      style={
                        inputStyle
                      }
                    />
                  </FormField>
                </div>

                {/* CUSTOMER */}

                <SectionTitle>
                  Customer Details
                </SectionTitle>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      gridColumn:
                        "1 / -1",
                    }}
                  >
                    <FormField
                      label="Customer"
                      required
                    >
                      <select
                        value={
                          form.customer_id
                        }
                        onChange={(
                          event
                        ) =>
                          updateForm(
                            "customer_id",
                            event.target
                              .value
                          )
                        }
                        required
                        style={
                          inputStyle
                        }
                      >
                        <option value="">
                          Select Customer
                        </option>

                        {customers.map(
                          (
                            customer
                          ) => (
                            <option
                              key={
                                customer.id
                              }
                              value={
                                customer.id
                              }
                            >
                              {customerCode(
                                customer.customer_code
                              )}{" "}
                              —{" "}
                              {customer.customer_name ||
                                "-"}
                              {customer.business_name
                                ? ` (${customer.business_name})`
                                : ""}
                            </option>
                          )
                        )}
                      </select>
                    </FormField>
                  </div>

                  <FormField label="Business Name">
                    <input
                      value={
                        selectedCustomer?.business_name ||
                        ""
                      }
                      readOnly
                      placeholder="Automatic"
                      style={{
                        ...inputStyle,
                        background:
                          "#f8fafc",
                      }}
                    />
                  </FormField>

                  <FormField label="Mobile Number">
                    <input
                      value={
                        selectedCustomer?.mobile ||
                        ""
                      }
                      readOnly
                      placeholder="Automatic"
                      style={{
                        ...inputStyle,
                        background:
                          "#f8fafc",
                      }}
                    />
                  </FormField>

                  <div
                    style={{
                      gridColumn:
                        "1 / -1",
                    }}
                  >
                    <FormField label="Address">
                      <textarea
                        value={
                          selectedCustomer?.business_address ||
                          ""
                        }
                        readOnly
                        rows={2}
                        placeholder="Automatic"
                        style={{
                          ...inputStyle,
                          background:
                            "#f8fafc",
                          resize:
                            "vertical",
                        }}
                      />
                    </FormField>
                  </div>
                </div>

                {/* QUANTITY */}

                <SectionTitle>
                  Module Quantity
                </SectionTitle>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "repeat(3,1fr)",
                    gap: 14,
                  }}
                >
                  <QuantityField
                    label="Repairing Qty"
                    value={
                      form.repairing_quantity
                    }
                    onChange={(value) =>
                      updateForm(
                        "repairing_quantity",
                        value
                      )
                    }
                  />

                  <QuantityField
                    label="Warranty Qty"
                    value={
                      form.warranty_quantity
                    }
                    onChange={(value) =>
                      updateForm(
                        "warranty_quantity",
                        value
                      )
                    }
                  />

                  <QuantityField
                    label="Reject Qty"
                    value={
                      form.reject_quantity
                    }
                    onChange={(value) =>
                      updateForm(
                        "reject_quantity",
                        value
                      )
                    }
                  />
                </div>

                {/* TOTAL */}

                <div
                  style={{
                    marginTop: 14,
                    padding:
                      "13px 16px",
                    borderRadius:
                      10,
                    background:
                      "#f8fafc",
                    border:
                      "1px solid #e2e8f0",
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
                    alignItems:
                      "center",
                  }}
                >
                  <span
                    style={{
                      color:
                        "#64748b",
                      fontSize: 13,
                      fontWeight:
                        600,
                    }}
                  >
                    Total Modules Received
                  </span>

                  <strong
                    style={{
                      fontSize: 18,
                      color:
                        "#0f172a",
                    }}
                  >
                    {totalReceived}
                  </strong>
                </div>

                {/* REPAIR DETAILS */}

                <SectionTitle>
                  Repair Details
                </SectionTitle>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 16,
                  }}
                >
                  <FormField
                    label="Technician Team (जिसने काम किया)"
                    required
                  >
                    {technicianError && (
                      <div
                        style={{
                          marginBottom: 10,
                          padding: "10px 12px",
                          borderRadius: 9,
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          color: "#991b1b",
                          fontSize: 12,
                          lineHeight: 1.6,
                        }}
                      >
                        <strong>Technicians load nahi ho paye.</strong>{" "}
                        {technicianError} — Agar ye <code>share_percent</code>{" "}
                        column ki error hai to <code>supabase/job-card-technicians-migration.sql</code>{" "}
                        Supabase me chalayein, phir page refresh karein.
                      </div>
                    )}
                    {/* Multi-select: Salary report inhi ticked workers ko
                        Module Service charge ka share deta hai. Tick na karna
                        hi "chutti" hai — uska share 0 ho jata hai. */}
                    <div
                      style={{
                        display:
                          "flex",
                        flexWrap:
                          "wrap",
                        gap: 8,
                      }}
                    >
                      {technicians.length ===
                      0 ? (
                        <small
                          style={{
                            color:
                              "#b91c1c",
                            fontSize: 12,
                          }}
                        >
                          Technician Master
                          me koi
                          technician nahi
                          hai.
                        </small>
                      ) : (
                        technicians.map(
                          (tech) => {
                            const checked =
                              selectedTechIds.includes(
                                tech.id
                              );

                            return (
                              <label
                                key={tech.id}
                                style={{
                                  display:
                                    "flex",
                                  alignItems:
                                    "center",
                                  gap: 7,
                                  padding:
                                    "8px 12px",
                                  borderRadius: 9,
                                  fontSize: 13,
                                  fontWeight: 700,
                                  cursor:
                                    "pointer",
                                  border: `1px solid ${
                                    checked
                                      ? "#2563eb"
                                      : "#cbd5e1"
                                  }`,
                                  background: checked
                                    ? "#eff6ff"
                                    : "#fff",
                                  color: checked
                                    ? "#1d4ed8"
                                    : "#334155",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(
                                    event
                                  ) =>
                                    setSelectedTechIds(
                                      (
                                        prev
                                      ) =>
                                        event
                                          .target
                                          .checked
                                          ? [
                                              ...prev,
                                              tech.id,
                                            ]
                                          : prev.filter(
                                              (
                                                id
                                              ) =>
                                                id !==
                                                tech.id
                                            )
                                    )
                                  }
                                  style={{
                                    cursor:
                                      "pointer",
                                  }}
                                />
                                {tech.name}
                                {Number(
                                  tech.share_percent ||
                                    0
                                ) >
                                  0 && (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color:
                                          "#64748b",
                                        fontWeight:
                                          600,
                                      }}
                                    >
                                      {Number(
                                        tech.share_percent
                                      )}
                                      %
                                    </span>
                                  )}
                              </label>
                            );
                          }
                        )
                      )}
                    </div>
                  </FormField>

                  <FormField
                    label="Service Type"
                    required
                  >
                    <select
                      value={
                        form.service_type
                      }
                      onChange={(
                        event
                      ) =>
                        updateForm(
                          "service_type",
                          event.target
                            .value
                        )
                      }
                      required
                      style={
                        inputStyle
                      }
                    >
                      {SERVICE_TYPES.map(
                        (
                          service
                        ) => (
                          <option
                            key={
                              service
                            }
                            value={
                              service
                            }
                          >
                            {service}
                          </option>
                        )
                      )}
                    </select>
                  </FormField>
                </div>

                {/* REMARK */}

                <div
                  style={{
                    marginTop: 20,
                  }}
                >
                  <FormField label="Remark">
                    <textarea
                      value={
                        form.remarks
                      }
                      onChange={(
                        event
                      ) =>
                        updateForm(
                          "remarks",
                          event.target
                            .value
                        )
                      }
                      rows={3}
                      placeholder="Received for repair"
                      style={{
                        ...inputStyle,
                        resize:
                          "vertical",
                      }}
                    />
                  </FormField>
                </div>

                {/* IMAGE */}

                <div
                  style={{
                    marginTop: 20,
                  }}
                >
                  <FormField label="Module Photo">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={
                        handleImage
                      }
                      style={{
                        ...inputStyle,
                        padding:
                          9,
                      }}
                    />
                  </FormField>

                  {form.module_image_url && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 10,
                        border:
                          "1px solid #e2e8f0",
                        borderRadius:
                          12,
                        width:
                          "fit-content",
                        background:
                          "#f8fafc",
                      }}
                    >
                      <img
                        src={
                          form.module_image_url
                        }
                        alt="Module"
                        style={{
                          width: 220,
                          height: 150,
                          objectFit:
                            "cover",
                          borderRadius:
                            9,
                          display:
                            "block",
                        }}
                      />

                      <button
                        type="button"
                        onClick={() =>
                          updateForm(
                            "module_image_url",
                            ""
                          )
                        }
                        style={{
                          marginTop: 8,
                          border:
                            "none",
                          background:
                            "transparent",
                          color:
                            "#dc2626",
                          cursor:
                            "pointer",
                          fontSize:
                            12,
                          fontWeight:
                            700,
                        }}
                      >
                        Remove Image
                      </button>
                    </div>
                  )}
                </div>

                {/* STATUS INFO */}

                <div
                  style={{
                    marginTop: 20,
                    padding: 14,
                    borderRadius:
                      12,
                    background:
                      "#eff6ff",
                    border:
                      "1px solid #bfdbfe",
                    color:
                      "#1e40af",
                    fontSize: 13,
                    lineHeight:
                      1.6,
                  }}
                >
                  <strong>
                    Job Card Status: Open
                  </strong>

                  <div>
                    Job Card invoice banne
                    tak Open rahega.
                    Invoice create hone
                    ke baad system ise
                    automatically Closed
                    karega.
                  </div>
                </div>
              </div>

              {/* FOOTER */}

              <div
                style={{
                  padding:
                    "16px 24px",
                  borderTop:
                    "1px solid #e2e8f0",
                  display:
                    "flex",
                  justifyContent:
                    "flex-end",
                  gap: 10,
                  background:
                    "#fafafa",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setShowForm(
                      false
                    )
                  }
                  style={{
                    padding:
                      "10px 18px",
                    border:
                      "1px solid #cbd5e1",
                    background:
                      "#ffffff",
                    borderRadius:
                      9,
                    cursor:
                      "pointer",
                    fontWeight:
                      600,
                  }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="customer-primary-button"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editing
                    ? "Update Job Card"
                    : "Create Job Card"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================
          VIEW JOB CARD MODAL
      ================================================ */}

      {showView &&
        viewing && (
          <div
            style={
              overlayStyle
            }
            onMouseDown={(
              event
            ) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setShowView(
                  false
                );
              }
            }}
          >
            <div
              style={{
                ...modalStyle,
                maxWidth: 850,
              }}
              onMouseDown={(
                event
              ) =>
                event.stopPropagation()
              }
            >
              {/* VIEW HEADER */}

              <div
                style={{
                  padding:
                    "22px 24px",
                  borderBottom:
                    "1px solid #e2e8f0",
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                  alignItems:
                    "center",
                }}
              >
                <div
                  style={{
                    display:
                      "flex",
                    alignItems:
                      "center",
                    gap: 13,
                  }}
                >
                  <div
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius:
                        13,
                      background:
                        "#eff6ff",
                      display:
                        "flex",
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                      fontSize: 21,
                    }}
                  >
                    📋
                  </div>

                  <div>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 22,
                      }}
                    >
                      {jobNumber(
                        viewing.job_no,
                        viewing.id
                      )}
                    </h2>

                    <p
                      style={{
                        margin:
                          "4px 0 0",
                        color:
                          "#64748b",
                      }}
                    >
                      Job Card Details
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setShowView(
                      false
                    )
                  }
                  style={{
                    width: 36,
                    height: 36,
                    border: "none",
                    borderRadius:
                      9,
                    background:
                      "#f1f5f9",
                    fontSize: 23,
                    cursor:
                      "pointer",
                  }}
                >
                  ×
                </button>
              </div>

              {/* VIEW CONTENT */}

              <div
                style={{
                  padding: 24,
                  maxHeight:
                    "70vh",
                  overflowY:
                    "auto",
                }}
              >
                <div
                  style={{
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
                    alignItems:
                      "center",
                    marginBottom: 20,
                    padding: 14,
                    background:
                      "#f8fafc",
                    borderRadius:
                      12,
                  }}
                >
                  <div>
                    <span
                      style={{
                        display:
                          "block",
                        fontSize: 12,
                        color:
                          "#64748b",
                      }}
                    >
                      Job Date
                    </span>

                    <strong>
                      {fmtDate(viewing.job_date) || "-"}
                    </strong>
                  </div>

                  <span
                    style={{
                      ...statusStyle(
                        viewing.status
                      ),
                      padding:
                        "7px 13px",
                      borderRadius:
                        20,
                      fontSize: 12,
                      fontWeight:
                        700,
                    }}
                  >
                    {viewing.status ||
                      "Open"}
                  </span>
                </div>

                <SectionTitle>
                  Customer Details
                </SectionTitle>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 14,
                  }}
                >
                  <ViewItem
                    label="Customer"
                    value={
                      customers.find(
                        (c) =>
                          c.id ===
                          viewing.customer_id
                      )
                        ?.customer_name ||
                      "-"
                    }
                  />

                  <ViewItem
                    label="Customer Code"
                    value={customerCode(
                      customers.find(
                        (c) =>
                          c.id ===
                          viewing.customer_id
                      )
                        ?.customer_code
                    )}
                  />

                  <ViewItem
                    label="Business Name"
                    value={
                      viewing.business_name ||
                      customers.find(
                        (c) =>
                          c.id ===
                          viewing.customer_id
                      )
                        ?.business_name ||
                      "-"
                    }
                  />

                  <ViewItem
                    label="Mobile"
                    value={
                      customers.find(
                        (c) =>
                          c.id ===
                          viewing.customer_id
                      )?.mobile ||
                      "-"
                    }
                  />

                  <div
                    style={{
                      gridColumn:
                        "1 / -1",
                    }}
                  >
                    <ViewItem
                      label="Address"
                      value={
                        customers.find(
                          (c) =>
                            c.id ===
                            viewing.customer_id
                        )
                          ?.business_address ||
                        "-"
                      }
                    />
                  </div>
                </div>

                <SectionTitle>
                  Repair Details
                </SectionTitle>

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "repeat(3,1fr)",
                    gap: 14,
                  }}
                >
                  <QuantityView
                    label="Repairing"
                    value={numberValue(
                      viewing.repairing_quantity
                    )}
                  />

                  <QuantityView
                    label="Warranty"
                    value={numberValue(
                      viewing.warranty_quantity
                    )}
                  />

                  <QuantityView
                    label="Reject"
                    value={numberValue(
                      viewing.reject_quantity
                    )}
                  />
                </div>

                <div
                  style={{
                    marginTop: 14,
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 14,
                  }}
                >
                  <ViewItem
                    label="Technician"
                    value={
                      viewing.technician ||
                      "-"
                    }
                  />

                  <ViewItem
                    label="Service Type"
                    value={
                      viewing.service_type ||
                      "-"
                    }
                  />
                </div>

                <SectionTitle>
                  Remark
                </SectionTitle>

                <div
                  style={{
                    padding: 14,
                    background:
                      "#f8fafc",
                    borderRadius:
                      10,
                    color:
                      "#334155",
                    lineHeight:
                      1.6,
                  }}
                >
                  {viewing.remarks ||
                    "-"}
                </div>

                {/* IMAGE */}

                {viewImage && (
                  <>
                    <SectionTitle>
                      Module Photo
                    </SectionTitle>

                    <div
                      style={{
                        padding: 12,
                        border:
                          "1px solid #e2e8f0",
                        borderRadius:
                          14,
                        background:
                          "#f8fafc",
                      }}
                    >
                      <img
                        src={
                          viewImage
                        }
                        alt="Received Module"
                        style={{
                          width:
                            "100%",
                          maxWidth: 500,
                          maxHeight: 350,
                          objectFit:
                            "contain",
                          display:
                            "block",
                          margin:
                            "0 auto",
                          borderRadius:
                            10,
                        }}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* VIEW FOOTER */}

              <div
                style={{
                  padding:
                    "16px 24px",
                  borderTop:
                    "1px solid #e2e8f0",
                  display:
                    "flex",
                  justifyContent:
                    "flex-end",
                  gap: 10,
                  background:
                    "#fafafa",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setShowView(
                      false
                    )
                  }
                  style={{
                    padding:
                      "10px 18px",
                    border:
                      "1px solid #cbd5e1",
                    background:
                      "#ffffff",
                    borderRadius:
                      9,
                    cursor:
                      "pointer",
                    fontWeight:
                      600,
                  }}
                >
                  Close
                </button>

                {viewing.status !==
                  "Closed" && (
                  <button
                    type="button"
                    className="customer-primary-button"
                    onClick={() => {
                      setShowView(
                        false
                      );

                      openEdit(
                        viewing
                      );
                    }}
                  >
                    ✏ Edit Job Card
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

// =====================================================
// SMALL COMPONENTS
// =====================================================

function SummaryCard({
  title,
  value,
  subtitle,
  icon,
  background,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: string;
  background: string;
}) {
  return (
    <div
      style={{
        background:
          "#ffffff",
        border:
          "1px solid #e2e8f0",
        borderRadius: 15,
        padding: 18,
        display:
          "flex",
        alignItems:
          "center",
        gap: 14,
        boxShadow:
          "0 3px 12px rgba(15,23,42,.03)",
      }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 12,
          background,
          display:
            "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          fontSize: 20,
        }}
      >
        {icon}
      </div>

      <div>
        <div
          style={{
            color:
              "#64748b",
            fontSize: 12,
            fontWeight:
              600,
          }}
        >
          {title}
        </div>

        <strong
          style={{
            display:
              "block",
            fontSize: 22,
            color:
              "#0f172a",
            marginTop: 2,
          }}
        >
          {value}
        </strong>

        <small
          style={{
            color:
              "#94a3b8",
          }}
        >
          {subtitle}
        </small>
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display:
          "flex",
        flexDirection:
          "column",
        gap: 7,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight:
            700,
          color:
            "#334155",
        }}
      >
        {label}

        {required && (
          <span
            style={{
              color:
                "#dc2626",
              marginLeft: 3,
            }}
          >
            *
          </span>
        )}
      </span>

      {children}
    </label>
  );
}

function QuantityField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (
    value: string
  ) => void;
}) {
  return (
    <FormField
      label={label}
    >
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
        placeholder="0"
        style={{
          ...inputStyle,
          fontSize: 17,
          fontWeight: 700,
        }}
      />
    </FormField>
  );
}

function SectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 24,
        marginBottom: 14,
        paddingBottom: 8,
        borderBottom:
          "1px solid #e2e8f0",
        color:
          "#0f172a",
        fontSize: 14,
        fontWeight: 800,
      }}
    >
      {children}
    </div>
  );
}

function ViewItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        padding: 13,
        border:
          "1px solid #e2e8f0",
        borderRadius: 10,
        background:
          "#ffffff",
      }}
    >
      <span
        style={{
          display:
            "block",
          color:
            "#64748b",
          fontSize: 11,
          fontWeight:
            600,
          marginBottom: 5,
        }}
      >
        {label}
      </span>

      <strong
        style={{
          color:
            "#0f172a",
          fontSize: 14,
          lineHeight:
            1.4,
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function QuantityView({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background:
          "#f8fafc",
        border:
          "1px solid #e2e8f0",
        textAlign:
          "center",
      }}
    >
      <span
        style={{
          display:
            "block",
          color:
            "#64748b",
          fontSize: 12,
          fontWeight:
            600,
        }}
      >
        {label}
      </span>

      <strong
        style={{
          display:
            "block",
          fontSize: 24,
          color:
            "#0f172a",
          marginTop: 5,
        }}
      >
        {value}
      </strong>
    </div>
  );
}

// =====================================================
// STYLES
// =====================================================

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 9,
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  outline: "none",
};

const filterStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #dbe3ef",
  borderRadius: 9,
  background: "#ffffff",
  color: "#334155",
  minWidth: 150,
  outline: "none",
};

const thStyle: React.CSSProperties = {
  padding: "13px 12px",
  textAlign: "left",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".03em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 12px",
  borderTop: "1px solid #eef2f7",
  color: "#334155",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const actionButton: React.CSSProperties = {
  width: 31,
  height: 31,
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  borderRadius: 8,
  cursor: "pointer",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 780,
  background: "#ffffff",
  borderRadius: 18,
  overflow: "hidden",
  boxShadow:
    "0 25px 70px rgba(15,23,42,.25)",
  maxHeight: "90vh",
};

export default JobCards;