import HistoryPanel from "../components/HistoryPanel";

export type Customer = {
  id: number;
  customer_code: number | null;
  customer_name: string | null;
  mobile: string | null;
  business_name: string | null;
  business_address: string | null;
  gst_available: boolean;
  gst_number: string | null;
  payment_term: string;
};

type CustomerDetailsProps = {
  customer: Customer;
  onClose: () => void;
};

const formatCustomerCode = (customerCode: number | null) =>
  `C${String(customerCode || 0).padStart(4, "0")}`;

function CustomerDetails({ customer, onClose }: CustomerDetailsProps) {
  const customerName = customer.customer_name || "Customer";

  return (
    <div
      className="customer-details-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="customer-details-panel" aria-label="Customer details">
        <header className="customer-details-header">
          <div className="customer-details-heading">
            <div className="customer-details-avatar">
              {customerName.charAt(0).toUpperCase()}
            </div>
            <div>
              <span className="customer-details-code">
                {formatCustomerCode(customer.customer_code)}
              </span>
              <h2>{customerName}</h2>
              <p>{customer.business_name || "Individual customer"}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close details">
            ×
          </button>
        </header>

        <div className="customer-details-content">
          <div className="customer-details-summary">
            <div className="customer-detail-stat">
              <span>Repair Jobs</span>
              <strong>0</strong>
              <small>No repair table connected yet</small>
            </div>
            <div className="customer-detail-stat">
              <span>Invoices</span>
              <strong>0</strong>
              <small>No invoice table connected yet</small>
            </div>
            <div className="customer-detail-stat">
              <span>Outstanding</span>
              <strong>₹0</strong>
              <small>No payment ledger connected yet</small>
            </div>
            <div className="customer-detail-stat">
              <span>Payment Term</span>
              <strong className="customer-detail-term">{customer.payment_term || "Cash"}</strong>
              <small>Saved customer preference</small>
            </div>
          </div>

          <div className="customer-details-grid">
            <section className="customer-detail-card customer-profile-card">
              <div className="customer-detail-card-header">
                <div>
                  <h3>Customer Information</h3>
                  <p>Live data from Customer Master</p>
                </div>
              </div>
              <dl className="customer-information-list">
                <div><dt>Customer Code</dt><dd>{formatCustomerCode(customer.customer_code)}</dd></div>
                <div><dt>Mobile</dt><dd>{customer.mobile || "Not added"}</dd></div>
                <div><dt>Business</dt><dd>{customer.business_name || "Not added"}</dd></div>
                <div><dt>GST Status</dt><dd>{customer.gst_available ? "GST Registered" : "Non-GST"}</dd></div>
                <div><dt>GST Number</dt><dd>{customer.gst_number || "Not applicable"}</dd></div>
                <div><dt>Address</dt><dd>{customer.business_address || "Not added"}</dd></div>
              </dl>
            </section>

            <section className="customer-detail-card">
              <div className="customer-detail-card-header">
                <div>
                  <h3>🕘 Change History</h3>
                  <p>Kab bana, kisne edit kiya, kya badla (audit trail)</p>
                </div>
              </div>
              <HistoryPanel entity="Customer" entityId={customer.id} />
            </section>

            <section className="customer-detail-card">
              <div className="customer-detail-card-header">
                <div><h3>Repair History</h3><p>Job cards and repair updates</p></div>
              </div>
              <EmptyHistory icon="🔧" message="No repair history is available yet." />
            </section>

            <section className="customer-detail-card">
              <div className="customer-detail-card-header">
                <div><h3>Invoice History</h3><p>Invoices and sales documents</p></div>
              </div>
              <EmptyHistory icon="🧾" message="No invoice history is available yet." />
            </section>

            <section className="customer-detail-card">
              <div className="customer-detail-card-header">
                <div><h3>Payment & Ledger</h3><p>Receipts, debits and running balance</p></div>
                <span className="customer-ledger-balance">Balance ₹0</span>
              </div>
              <EmptyHistory icon="₹" message="No payment or ledger entries are available yet." />
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyHistory({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="customer-history-empty">
      <span>{icon}</span>
      <p>{message}</p>
      <small>Records will appear here once this module is added.</small>
    </div>
  );
}

export default CustomerDetails;
