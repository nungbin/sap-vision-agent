# INTENT
This task runs the UI5 Product Creation Wizard. It handles creating new product entries, filling out specifications, and submitting the wizard form to the OData backend. 
Trigger: "run the wizard", "create a product", "add a new material", or "test the UI5 app".

# TYPE
UI5

# TARGET
http://192.168.1.251:8000/sap/bc/ui5_ui5/sap/zwizard_test/index.html?sap-client=001

# PARAMETERS
The AI must extract or infer the following parameters from the conversation before executing:
- `productType`: (String) Must be exactly "Mobile", "Desktop", or "Tablet". If the user doesn't specify, default to "Mobile".
- `productName`: (String) The name of the product to create. If the user doesn't specify, default to a generic test name like "TEST_PROD_01".
- `productWeight`: (Number) The weight of the product in KG. If the user doesn't specify, default to "1".