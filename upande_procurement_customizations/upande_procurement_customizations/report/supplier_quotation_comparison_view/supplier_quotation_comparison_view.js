frappe.query_reports["Supplier Quotation Comparison View"] = {
    filters: [
        {
            fieldname: "rfq",
            label: __("Request for Quotation"),
            fieldtype: "Link",
            options: "Request for Quotation",
            reqd: 1
        }
    ],

    onload: function (report) {
        report.page.add_inner_button(__("Create Purchase Orders"), function () {
            const selected = getSelectedQuotations();

            if (selected.length === 0) {
                return frappe.msgprint(__("Please select at least one quotation item."));
            }

            frappe.confirm(__("Create Purchase Orders for selected items?"), () => {
                frappe.show_progress(__("Creating Purchase Orders..."), 100, 100, __("Please wait"));

                frappe.call({
                    method: "upande_timaflor.upande_timaflor.report.supplier_quotation_comparison_view.supplier_quotation_comparison_view.create_purchase_orders_from_rfq",
                    args: { selections: JSON.stringify(selected) },
                    callback: function (r) {
                        frappe.hide_progress();
                        if (r.message && r.message.purchase_orders && r.message.purchase_orders.length > 0) {
                            const links = r.message.purchase_orders.map(name =>
                                `<li><a href="/app/purchase-order/${name}" target="_blank">${name}</a></li>`
                            ).join("");

                            frappe.msgprint({
                                title: __("Purchase Orders Created"),
                                message: `<ul>${links}</ul>`,
                                indicator: "green"
                            });

                            markItemsAsUsed(selected).then(() => {
                                report.refresh();
                            });
                        } else if (r.exc) {
                            frappe.msgprint({
                                title: __("Error"),
                                message: __("An error occurred while creating Purchase Orders. Please check the console for details."),
                                indicator: "red"
                            });
                            console.error(r.exc);
                        } else {
                            frappe.msgprint(__("No Purchase Orders were created."));
                        }
                    },
                    error: function (err) {
                        frappe.hide_progress();
                        frappe.msgprint(__("Unable to create Purchase Orders. An unexpected error occurred."));
                        console.error(err);
                    }
                });
            });
        });
    }
};

function getSelectedQuotations() {
    return Array.from(document.querySelectorAll(".sq-select:checked")).map(checkbox => {
        const data = checkbox.dataset;
        return {
            item_code: data.item,
            item_name: data.itemName,
            uom: data.uom,
            qty: parseFloat(data.qty),
            rate: parseFloat(data.rate),
            supplier: data.supplier,
            currency: data.currency,
            quotation_item: data.quotationItem
        };
    });
}

function markItemsAsUsed(selections) {
    return new Promise((resolve) => {
        frappe.call({
            method: "upande_timaflor.upande_timaflor.report.supplier_quotation_comparison_view.supplier_quotation_comparison_view.mark_items_po_created",
            args: { item_names: JSON.stringify(selections.map(s => s.quotation_item)) },
            callback: function(r) {
                if (!r.exc) {
                    console.log("Items marked as used:", r.message);
                } else {
                    console.error("Error marking items:", r.exc);
                }
                resolve();
            }
        });
    });
}

function build_table_data(rfq_items, supplier_quotes, company_currency, rfq_name) {
    const supplier_meta = {};
    supplier_quotes.forEach(quote => {
        const supplier = quote.supplier;
        if (!supplier_meta[supplier]) {
            supplier_meta[supplier] = {
                currency: quote.currency || company_currency,
                quotation_name: quote.quotation_name
            };
        }
    });

    const suppliers = Object.keys(supplier_meta).sort();

    const columns = [
        {label: _("QTY"), fieldname: "rfq_qty", fieldtype: "Float", width: 80},
        {label: _("UOM"), fieldname: "uom", fieldtype: "Data", width: 80},
        {label: _("ITEM CODE"), fieldname: "item_code", fieldtype: "Data", width: 120},
        {label: _("ITEM NAME"), fieldname: "item_name", fieldtype: "Data", width: 260}
    ];

    suppliers.forEach(supplier => {
        const quotation_name = supplier_meta[supplier].quotation_name;
        const link = `/app/supplier-quotation/${quotation_name}`;
        columns.push({
            label: `<a href="${link}" style="text-decoration:none;" target="_blank">${supplier}</a>`,
            fieldname: supplier,
            fieldtype: "HTML",
            width: 300
        });
    });

    const rate_map = {};
    supplier_quotes.forEach(q => {
        const key = [q.item_code, q.supplier];
        rate_map[key] = {
            rate: q.rate,
            currency: q.currency || company_currency,
            quotation_name: q.quotation_name,
            item_name: q.item_name,
            uom: q.uom,
            qty: q.qty,
            name: q.name,
            custom_po_created: q.custom_po_created || 0
        };
    });

    const data = [];
    const rfq_item_qty_map = {};
    rfq_items.forEach(item => {
        rfq_item_qty_map[item.item_code] = frappe.get_doc("Request for Quotation Item", {
            parent: rfq_name,
            item_code: item.item_code
        })?.qty || 0;
    });

    rfq_items.forEach(item => {
        const row = {
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
            rfq_qty: rfq_item_qty_map[item.item_code]
        };

        const item_rates_for_comparison = {};
        suppliers.forEach(sup => {
            const meta = rate_map[[item.item_code, sup]];
            if (meta && meta.rate !== null) {
                item_rates_for_comparison[sup] = meta.rate;
            }
        });

        const valid_rates = Object.values(item_rates_for_comparison);
        const min_rate = valid_rates.length ? Math.min(...valid_rates) : null;
        const max_rate = valid_rates.length ? Math.max(...valid_rates) : null;

        suppliers.forEach(sup => {
            const meta = rate_map[[item.item_code, sup]];
            if (!meta) {
                row[sup] = "";
                return;
            }

            const rate = meta.rate;
            const currency = meta.currency;
            const item_name = meta.item_name;
            const uom = meta.uom;
            const qty = meta.qty;
            const quotation_item = meta.name;
            const is_read_only = meta.custom_po_created;

            let color = "black";
            if (rate !== null) {
                if (min_rate !== null && rate === min_rate) {
                    color = "green";
                } else if (max_rate !== null && rate === max_rate) {
                    color = "red";
                }
            }

            const money_formatted = rate !== null ? frappe.utils.fmt_money(rate, 2, currency) : _("N/A");

            const checkbox = (
                `<input type="checkbox" class="sq-select" `
                + `data-item="${item.item_code}" data-item-name="${item_name}" data-uom="${uom}" `
                + `data-qty="${qty}" data-rate="${rate}" data-supplier="${sup}" `
                + `data-currency="${currency}" data-quotation-item="${quotation_item}" `
                + `${is_read_only ? 'disabled' : ''}>`
            );

            row[sup] = `${checkbox}<span style="color:${color};">${money_formatted}</span>`;
        });

        data.push(row);
    });

    return [columns, data];
}