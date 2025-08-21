frappe.query_reports["Supplier Ledger View"] = {
    filters: [
        {
            fieldname: "supplier",
            label: "Supplier",
            fieldtype: "Link",
            options: "Supplier"
        },
        {
            fieldname: "from_date",
            label: "From Date",
            fieldtype: "Date",
            default: frappe.datetime.month_start()
        },
        {
            fieldname: "to_date",
            label: "To Date",
            fieldtype: "Date",
            default: frappe.datetime.get_today()
        }
    ],

    formatter: function (value, row, column, data, default_formatter) {
        // 👇 Debug line: check if formatter is running
        console.log("Formatter loaded!", column.fieldname, value);

        value = default_formatter(value, row, column, data);

        if (column.fieldname === "supplier_link" && data && data.supplier_link) {
            const supplier = encodeURIComponent(data.supplier_link);
            const from_date = frappe.query_report.get_filter_value("from_date");
            const to_date = frappe.query_report.get_filter_value("to_date");

            return `<a href="javascript:void(0)" onclick="frappe.set_route('query-report', 'Supplier Ledger View', {
                supplier: '${supplier}',
                from_date: '${from_date}',
                to_date: '${to_date}'
            })">${value}</a>`;
        }

        return value;
    }
};
