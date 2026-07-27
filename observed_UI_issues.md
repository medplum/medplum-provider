- Is an encounter being created for the intake?
- I can't find a way in the UI to show the encounters I think there was one before
- under patient the careplan has a field for encounter and its empty: 
    http://localhost:3001/Patient/e51b76e1-9af4-4fd1-aade-ef2c4eaadb9e/CarePlan/1040288c-8838-4c8a-90b3-bd6d221bc81c  This is the plan created by the intake form

- edit on a patient gives this error:

    Not found

    Could not find the US Core Patient Profile

    Server error: StructureDefinition profile with URL http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient not found

    URL: http://localhost:3001/Patient/e51b76e1-9af4-4fd1-aade-ef2c4eaadb9e/edit

- On a patient display there should be buttons to start an admission screening, and another for a new encounter. Both should generate with pre populated patient information.

- export tab takes a date time input, this should accept just a date if no time added. Can the end date default to now?
- the patient display has both the DJS and the regular data, they should be consolidated. 

- each page of the intake form the "Save" button should be "save and next" and move you to the next tab